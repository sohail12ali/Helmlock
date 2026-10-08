// The run manager (service "runManager"): agent runs started from the server (console, Telegram, the crew), F65, F97,
// F134, and milestone 8 (Blueprint 33, F152-F157). One active run per ticket, an identical start within 10 s coalesces,
// events are buffered with sequence numbers so a browser can replay and follow, silence is flagged at 5 and 15 minutes,
// cancel is a tree kill, and the run record is the same runs/<id>.json that `hl run` writes. Claude runs started by
// the server get a per-run --settings file with a PreToolUse hook that asks a person through the server
// (control-center agent_approvals.py write_settings).
// Milestone 8: a concurrency cap with a FIFO queue; one engine session per (role, ticket), resumed when the engine,
// cwd and role instructions are unchanged; messages steer a live run when the engine can, else wait for a follow-up
// run on the same session; outcomes from `hl run report`; a git worktree per ticket for build runs, with diff and merge.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Context, EngineCapabilities, RunEvent, RunManagerService, RunMode, RunOutcome, RunStartOptions, RunState } from "@helmlock/core";
import { agentNotice } from "../harness/layers.ts";
import { type ManagedRunOptions, newRunId } from "./process-run.ts";
import { RUNTIME_ALIASES } from "./registry.ts";
import { buildRecord, RECORD_NAME, type RunRecord, RunTally, readRecord, recordToState, stampResponsible, writeRunRecord } from "./run-record.ts";
import { takeReportFile, writeOutcome } from "./run-report.ts";
import { baseRunEnv, defaultAddDirs, MODES } from "./run-verb.ts";
import { createSessionStore, instructionsHash } from "./sessions.ts";
import { commitWip, cwdInWorktree, ensureWorktree, mergeWorktree, repoRoot, type WorktreeInfo, worktreeDiff } from "./worktree.ts";

export const COALESCE_MS = 10_000;
export const BUFFER_CAP = 5_000;
export const SILENCE_FLAGS_MS = [5 * 60_000, 15 * 60_000] as const;
export const DEFAULT_MAX_LIVE = 2;
const FINISHED_KEPT = 100;

/** Tools that reach the approval hook. Edits are accepted without a card in auto-review (acceptEdits). */
export const GATED_TOOLS = ["Bash", "Write", "Edit", "MultiEdit", "WebFetch"] as const;
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

/** The hook script of the harness plugin, next to this package. */
export const PRETOOL_SCRIPT = resolve(import.meta.dirname, "..", "harness", "hooks", "pretool.ts");

export class RunError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  constructor(rule: string, message: string, fix?: string) {
    super(message);
    this.rule = rule;
    this.fix = fix;
  }
}

export interface RunEventLine {
  seq: number;
  ts: string;
  event: RunEvent;
}

export interface RunManagerOptions {
  ctx: Context;
  defaultRuntime?: string;
  defaultSilenceSec?: number;
  /** Live runs at once; more wait in a FIFO queue (setting agents.max_live, default 2). */
  maxLive?: number;
  coalesceMs?: number;
  bufferCap?: number;
  silenceFlagsMs?: readonly number[];
  /** How often silence is checked. */
  tickMs?: number;
  /** Node binary and hook script used in the per-run settings file (tests may override). */
  node?: string;
  hookScript?: string;
}

interface Live {
  state: RunState;
  /** The start options (prompt included): a queued run starts from them, a follow-up run copies them. */
  opts: RunStartOptions & { prompt: string };
  key: string;
  startedAt: number;
  buf: RunEventLine[];
  nextSeq: number;
  waiters: Set<() => void>;
  ended: boolean;
  cancel?: () => Promise<void>;
  steer?: (text: string) => Promise<void>;
  cancelledBy?: string;
  /** Messages for the next turn (engines that cannot steer, or a run that stopped taking them). */
  queued: { text: string; by: string }[];
  reported: boolean;
  sessionId?: string;
  wt?: WorktreeInfo;
}

const q = (p: string) => `"${p.replaceAll("\\", "/")}"`;

/** The --settings JSON for one run: a PreToolUse hook on the gated tools that asks the server. */
export function hookSettings(o: { node: string; script: string; mode: RunMode; timeoutSec: number }): unknown {
  const tools = GATED_TOOLS.filter((t) => !(o.mode === "auto-review" && EDIT_TOOLS.has(t)));
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: `^(${tools.join("|")})$`,
          hooks: [{ type: "command", command: `${q(o.node)} ${q(o.script)} --host claude --server --timeout ${o.timeoutSec}`, timeout: o.timeoutSec + 60 }],
        },
      ],
    },
  };
}

/** The prompt of a follow-up run: the messages that waited for the run to end. */
export function followUpPrompt(msgs: readonly { text: string; by: string }[]): string {
  if (msgs.length === 1) return `Message from ${msgs[0]?.by}: ${msgs[0]?.text}`;
  return ["Messages that arrived while you were working:", ...msgs.map((m) => `- ${m.by}: ${m.text}`)].join("\n");
}

export type RunManager = RunManagerService & {
  dispose(): void;
  /** report() with the activity line optional: `hl run report` writes its own. */
  report(id: string, outcome: RunOutcome, by: string, opts?: { activity?: boolean }): Promise<RunState>;
};

const NO_CAPS: EngineCapabilities = { resume: false, steer: false, approve: false, models: false };

export function createRunManager(o: RunManagerOptions): RunManager {
  const { ctx } = o;
  const runs = new Map<string, Live>();
  const waiting: Live[] = [];
  const coalesceMs = o.coalesceMs ?? COALESCE_MS;
  const cap = o.bufferCap ?? BUFFER_CAP;
  const flags = o.silenceFlagsMs ?? SILENCE_FLAGS_MS;
  const maxLive = Math.max(1, o.maxLive ?? DEFAULT_MAX_LIVE);
  const sessions = createSessionStore(() => ctx.get("files"));
  /** Approval card id -> run id, so a decision lands on the run's timeline. */
  const approvalRuns = new Map<string, string>();

  const wake = (r: Live) => {
    for (const w of [...r.waiters]) w();
    r.waiters.clear();
  };
  // The transcript is also appended to runs/<id>.events.jsonl (local, gitignored with runs/) so a finished run can be
  // replayed after the server restarts; the in-memory buffer only covers runs started by this process.
  const eventsFile = (id: string) => join(ctx.get("workspace").root, "runs", `${id}.events.jsonl`);
  const persist = (id: string, line: RunEventLine) => {
    try {
      const f = eventsFile(id);
      mkdirSync(join(f, ".."), { recursive: true });
      appendFileSync(f, `${JSON.stringify(line)}\n`, "utf8");
    } catch {
      /* the live buffer still works; a lost transcript line must never break the run */
    }
  };
  const push = (r: Live, event: RunEvent) => {
    const line: RunEventLine = { seq: r.nextSeq++, ts: new Date().toISOString(), event };
    r.buf.push(line);
    persist(r.state.id, line);
    if (r.buf.length > cap) r.buf.splice(0, r.buf.length - cap);
    wake(r);
  };
  const prune = () => {
    const finished = [...runs.values()].filter((r) => r.ended);
    for (const r of finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT))) runs.delete(r.state.id);
  };
  const liveCount = () => [...runs.values()].filter((r) => !r.ended && r.state.status === "running").length;
  const copy = (r: Live): RunState => ({ ...r.state, ...(r.state.worktree ? { worktree: { ...r.state.worktree } } : {}) });

  /** Start queued runs while there is a free slot (FIFO). */
  const drain = () => {
    while (waiting.length && liveCount() < maxLive) {
      const r = waiting.shift() as Live;
      if (r.ended) continue;
      r.state.status = "running";
      r.state.started = new Date().toISOString();
      launch(r).catch((e: unknown) => {
        push(r, { type: "error", message: `could not start: ${(e as Error).message}` });
        Object.assign(r.state, {
          status: "failed",
          ended: new Date().toISOString(),
          failure_class: "start-failed",
          outcome: "none",
        } satisfies Partial<RunState>);
        r.ended = true;
        wake(r);
        drain();
      });
    }
  };

  async function updateRecord(id: string, patch: Partial<RunRecord>): Promise<void> {
    const files = ctx.get("files");
    const raw = await readRecord(files, id);
    if (!raw) return;
    await files.writeText(`runs/${id}.json`, `${JSON.stringify({ ...raw, ...patch }, null, 2)}\n`);
  }

  async function launch(r: Live): Promise<void> {
    const opts = r.opts;
    const ws = ctx.get("workspace");
    const files = ctx.get("files");
    const adapter = ctx.get("runtimes").get(r.state.runtime);
    if (!adapter) throw new RunError("unknown-runtime", `no runtime "${r.state.runtime}"`);
    const caps = adapter.capabilities ?? NO_CAPS;
    const id = r.state.id;
    let cwd = resolve(opts.cwd ?? ws.root);
    r.state.queued_messages = 0;

    // F156: a build run works in the ticket's worktree on hl/<ticket>.
    if (opts.worktree && opts.ticket) {
      const repo = await repoRoot(cwd);
      if (repo) {
        r.wt = await ensureWorktree(ws.root, repo, opts.ticket);
        cwd = cwdInWorktree(cwd, r.wt);
        r.state.worktree = { path: r.wt.path, branch: r.wt.branch, repo: r.wt.repo };
        push(r, { type: "stderr", text: `[hl] working in the worktree ${r.wt.path} on ${r.wt.branch}` });
      } else push(r, { type: "stderr", text: `[hl] ${cwd} is not in a git repo: working in place, no worktree` });
    }

    // F155: one session per (role, ticket).
    const role = opts.role;
    const hash = role ? instructionsHash([ws.root, ws.deliveryRoot], role) : undefined;
    let resume = opts.resumeSessionId;
    if (role && opts.ticket && !resume && !opts.fresh && caps.resume) {
      const found = await sessions.resumable(role, opts.ticket, { engine: adapter.id, cwd, instructions_hash: hash as string });
      if (found.session) resume = found.session;
      push(r, { type: "stderr", text: found.session ? `[hl] resuming the ${role} session on ${opts.ticket}` : `[hl] fresh session (${found.reason})` });
    }

    const env: Record<string, string> = { ...baseRunEnv(ws.root), ...(opts.env ?? {}), HL_RUN_ID: id, ...(role ? { HL_ROLE: role } : {}) };
    const agent = opts.agent ?? role;
    let run: ManagedRunOptions = {
      prompt: opts.prompt,
      cwd,
      addDirs: opts.addDirs ?? defaultAddDirs(ws.folders, cwd),
      mode: r.state.mode,
      silenceSec: opts.silenceSec ?? o.defaultSilenceSec ?? 1800,
      env,
      runId: id,
      ...(agent ? { agent } : {}),
      ...(role ? { role } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.ticket ? { ticket: opts.ticket } : {}),
      ...(resume ? { resumeSessionId: resume } : {}),
      ...(opts.timeoutSec ? { timeoutSec: opts.timeoutSec } : {}),
      ...(caps.steer ? { live: true } : {}),
    };
    let settingsRel: string | undefined;
    if (env.HL_SERVER_URL && env.HL_HOOK_TOKEN) {
      if (adapter.id === "claude-code") {
        const qc = ctx.has("config") ? ctx.get("config").pluginConfig("approval-queue") : {};
        const timeoutSec = typeof qc.approval_timeout_sec === "number" ? qc.approval_timeout_sec : 300;
        settingsRel = `runs/hooks/${id}.settings.json`;
        const settings = hookSettings({ node: o.node ?? process.execPath, script: o.hookScript ?? PRETOOL_SCRIPT, mode: r.state.mode, timeoutSec });
        await files.writeText(settingsRel, `${JSON.stringify(settings, null, 2)}\n`);
        run = { ...run, extraArgs: ["--settings", join(ws.root, settingsRel)], approvalHook: true };
      } else {
        // No hook fires in a headless Cursor run (pre-flight): the token stays in the server; plan/ask modes and the
        // post-run protected-path check are the guard. `hl run report` falls back to runs/reports/<id>.json.
        delete env.HL_SERVER_URL;
        delete env.HL_HOOK_TOKEN;
      }
    }
    run = (await ctx.runHook("agent/pre-run", run)) as ManagedRunOptions;
    if (run.mode === "force") throw new RunError("mode-not-allowed", 'mode "force" stays in the terminal (hl run --mode force)');
    // .claude/agents holds the layer winners after `hl harness sync` (Blueprint 31): say so when it is behind.
    const notice = run.agent ? agentNotice(ws.root, ws.deliveryRoot, ws.author, run.agent) : undefined;
    if (notice) push(r, { type: "stderr", text: notice });

    let handle: Awaited<ReturnType<typeof adapter.start>>;
    try {
      handle = await adapter.start(run);
    } catch (e) {
      if (settingsRel) await files.remove(settingsRel).catch(() => {});
      throw e;
    }
    r.cancel = () => handle.cancel();
    if (handle.steer && caps.steer) r.steer = (text) => (handle.steer as (t: string) => Promise<void>)(text);
    if (r.cancelledBy) void handle.cancel();
    await ctx.emit("run.started", { runId: id, runtime: adapter.id, ...(run.ticket ? { ticket: run.ticket } : {}) });

    const tally = new RunTally();
    let lastOutput = Date.now();
    let flagged = 0;
    let staleSession = false;
    const tick = setInterval(() => {
      const silent = Date.now() - lastOutput;
      while (flagged < flags.length && silent >= (flags[flagged] as number)) {
        const min = Math.round((flags[flagged] as number) / 60_000);
        push(r, {
          type: "stderr",
          text: `[hl] no output for ${min > 0 ? `${min} min` : `${Math.round(silent / 1000)} s`}; the run is still alive (cancel to stop it)`,
        });
        flagged++;
      }
    }, o.tickMs ?? 10_000);
    tick.unref?.();

    void (async () => {
      let done = { ok: false, exitCode: null as number | null, timedOut: false };
      try {
        for await (const ev of handle.events) {
          lastOutput = Date.now();
          flagged = 0;
          tally.add(ev);
          if (ev.type === "usage")
            r.state.usage = { input_tokens: tally.usage.input_tokens, output_tokens: tally.usage.output_tokens, cost_usd: tally.usage.cost_usd };
          if ((ev.type === "init" || ev.type === "result") && ev.sessionId) r.sessionId = ev.sessionId;
          if (ev.type === "init" && ev.model && !r.state.model) r.state.model = ev.model;
          if (ev.type === "stderr" && ev.text.startsWith("[hl] unknown_session")) staleSession = true;
          push(r, ev);
        }
        done = await handle.done;
      } catch (e) {
        push(r, { type: "stderr", text: `[hl] run lost: ${(e as Error).message}` });
      } finally {
        clearInterval(tick);
      }
      r.steer = undefined; // from here on, messages wait for a follow-up run
      const cancelled = r.cancelledBy !== undefined;
      if (cancelled) done = { ...done, ok: false };

      // The worktree keeps everything the run did as one commit, so Merge needs no extra step.
      if (r.wt) {
        try {
          if (await commitWip(r.wt, `wip: ${opts.ticket} (${role ?? adapter.id}, run ${id})`))
            push(r, { type: "stderr", text: `[hl] committed the run's changes on ${r.wt.branch}` });
        } catch (e) {
          push(r, { type: "stderr", text: `[hl] could not commit the worktree: ${(e as Error).message}` });
        }
      }
      // An outcome reported through runs/reports/<id>.json (Cursor runs and runs without a server channel).
      if (!r.reported) {
        const filed = await takeReportFile(ctx, id).catch(() => undefined);
        if (filed) await applyReport(r, filed.outcome, { activity: false });
      }
      // No report: the state and the record say "none" (shown as "no outcome"), no event needed.
      if (!r.reported) r.state.outcome = "none";
      // F155: keep the session for the next hand-off of this role on this ticket.
      if (role && opts.ticket) {
        try {
          if (r.sessionId && caps.resume)
            await sessions.set(role, opts.ticket, { engine: adapter.id, session_id: r.sessionId, cwd, instructions_hash: hash as string });
          else if (staleSession) await sessions.delete(role, opts.ticket);
        } catch (e) {
          push(r, { type: "stderr", text: `[hl] could not save the session: ${(e as Error).message}` });
        }
      }

      const record = buildRecord(id, adapter.id, run, r.state.started, done, tally, cancelled ? "cancelled" : undefined);
      if (r.state.origin) record.origin = r.state.origin;
      if (role) record.role = role;
      if (r.state.outcome) record.outcome = r.state.outcome;
      if (r.state.worktree) record.worktree = { ...r.state.worktree };
      if (!record.model && r.state.model) record.model = r.state.model;
      stampResponsible(record, opts.actor.onBehalfOf);
      try {
        await writeRunRecord(files, record);
      } catch (e) {
        push(r, { type: "stderr", text: `[hl] could not write the run record: ${(e as Error).message}` });
      }
      if (settingsRel) await files.remove(settingsRel).catch(() => {});
      Object.assign(r.state, {
        status: cancelled ? "cancelled" : done.ok ? "done" : "failed",
        ended: record.ended,
        usage: { input_tokens: record.usage.input_tokens, output_tokens: record.usage.output_tokens, cost_usd: record.usage.cost_usd },
        ...(record.first_result_line ? { first_result_line: record.first_result_line } : {}),
        ...(record.failure_class ? { failure_class: record.failure_class } : {}),
      } satisfies Partial<RunState>);
      r.ended = true;
      // Messages that waited: a follow-up run on the same session (F155), unless a person cancelled the run.
      if (r.queued.length && !cancelled) await followUp(r);
      wake(r);
      await ctx.emit("run.finished", { runId: id, runtime: adapter.id, ok: done.ok, ...(run.ticket ? { ticket: run.ticket } : {}) });
      prune();
      drain();
    })();
  }

  /** Starts the run that carries a finished run's queued messages; resumes the (role, ticket) or the run's session. */
  async function followUp(r: Live): Promise<RunState | undefined> {
    const msgs = r.queued.splice(0);
    r.state.queued_messages = 0;
    const { resumeSessionId: _old, ...o0 } = r.opts;
    try {
      const next = await manager.start({
        ...o0,
        prompt: followUpPrompt(msgs),
        fresh: false,
        // Without a role and ticket there is no session entry: resume this run's own session directly.
        ...(!(o0.role && o0.ticket) && r.sessionId ? { resumeSessionId: r.sessionId } : {}),
      });
      push(r, { type: "stderr", text: `[hl] ${msgs.length} queued message${msgs.length === 1 ? "" : "s"} went to run ${next.id}` });
      return next;
    } catch (e) {
      push(r, { type: "error", message: `the queued messages could not start a follow-up run: ${(e as Error).message}` });
      return undefined;
    }
  }

  async function applyReport(r: Live, outcome: RunOutcome, opts: { activity: boolean }): Promise<void> {
    r.reported = true;
    r.state.outcome = outcome;
    push(r, { type: "outcome", outcome });
    const problems = await writeOutcome(
      ctx,
      { id: r.state.id, ticket: r.state.ticket, role: r.state.role, agent: r.state.agent, runtime: r.state.runtime, responsible: r.opts.actor.onBehalfOf },
      outcome,
      opts,
    );
    for (const p of problems) push(r, { type: "stderr", text: `[hl] ${p}` });
  }

  /** A run in memory, or one from its record (finished before this server started). */
  async function stateOf(id: string): Promise<RunState | undefined> {
    const r = runs.get(id);
    if (r) return copy(r);
    const raw = await readRecord(ctx.get("files"), id);
    return raw ? recordToState(raw, id) : undefined;
  }

  const worktreeOf = async (id: string): Promise<{ state: RunState; wt: WorktreeInfo }> => {
    const state = await stateOf(id);
    if (!state) throw new RunError("unknown-run", `no run ${id}`);
    if (!state.worktree) throw new RunError("no-worktree", `run ${id} did not work in a worktree`, "only build runs with worktree on get one");
    return { state, wt: { path: state.worktree.path, branch: state.worktree.branch, repo: state.worktree.repo } };
  };

  // Approval cards of a run show on its timeline (the queue emits; the run manager owns the timeline).
  const offRequested = ctx.on("approval.requested", (p) => {
    const r = p.runId ? runs.get(p.runId) : undefined;
    if (!r || r.ended) return;
    approvalRuns.set(p.id, r.state.id);
    push(r, { type: "approval", id: p.id, status: "pending", summary: `${p.action}: ${p.detail}`.slice(0, 300) });
  });
  const offDecided = ctx.on("approval.decided", (p) => {
    const runId = approvalRuns.get(p.id);
    approvalRuns.delete(p.id);
    const r = runId ? runs.get(runId) : undefined;
    if (!r) return;
    const summary = p.decision === "allow" ? `allowed by ${p.by}` : p.channel === "timeout" ? `no answer (${p.by}): denied` : `denied by ${p.by}`;
    push(r, { type: "approval", id: p.id, status: p.decision === "allow" ? "allowed" : "denied", summary });
  });

  const manager: RunManager = {
    async start(opts) {
      const mode = opts.mode ?? "plan";
      if (mode === "force") throw new RunError("mode-not-allowed", 'mode "force" stays in the terminal', "use plan, ask or auto-review");
      if (!(MODES as readonly string[]).includes(mode)) throw new RunError("bad-mode", `mode ${mode} is not on the ladder`);
      const prompt = (opts.prompt ?? "").trim();
      if (!prompt) throw new RunError("bad-request", "say what to do (task is empty)");
      const key = `${opts.ticket ?? ""}\0${opts.role ?? ""}\0${prompt}`;
      const now = Date.now();
      // F134: the same task on the same ticket within 10 s is one run (a double click, a retried request).
      const twin = [...runs.values()].find((r) => r.key === key && now - r.startedAt < coalesceMs);
      if (twin) return copy(twin);
      if (opts.ticket) {
        const busy = [...runs.values()].find((r) => !r.ended && r.state.ticket === opts.ticket);
        if (busy)
          throw new RunError(
            "run-active",
            `run ${busy.state.id} is still ${busy.state.status === "queued" ? "queued" : "active"} on ${opts.ticket}`,
            `send it a message, wait for it or cancel it (POST /api/v1/runs/${busy.state.id}/cancel)`,
          );
      }
      const name = opts.runtime ?? o.defaultRuntime ?? "claude-code";
      const runtimeId = RUNTIME_ALIASES[name] ?? name;
      const adapter = ctx.get("runtimes").get(runtimeId);
      if (!adapter)
        throw new RunError(
          "unknown-runtime",
          `no runtime "${name}"`,
          `registered: ${
            ctx
              .get("runtimes")
              .list()
              .map((a) => a.id)
              .join(", ") || "none"
          }`,
        );
      const queued = liveCount() >= maxLive;
      const r: Live = {
        state: {
          id: newRunId(),
          runtime: adapter.id,
          mode,
          status: queued ? "queued" : "running",
          started: new Date(now).toISOString(),
          capabilities: { ...(adapter.capabilities ?? NO_CAPS) },
          queued_messages: 0,
          ...(opts.agent || opts.role ? { agent: opts.agent ?? opts.role } : {}),
          ...(opts.role ? { role: opts.role } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.ticket ? { ticket: opts.ticket } : {}),
          ...(opts.origin ? { origin: opts.origin } : {}),
        },
        opts: { ...opts, prompt },
        key,
        startedAt: now,
        buf: [],
        nextSeq: 0,
        waiters: new Set(),
        ended: false,
        queued: [],
        reported: false,
      };
      // Reserved before any await, so two concurrent starts on one ticket cannot both pass the check.
      runs.set(r.state.id, r);
      if (queued) {
        waiting.push(r);
        push(r, { type: "stderr", text: `[hl] queued: ${maxLive} run${maxLive === 1 ? " is" : "s are"} live (agents.max_live)` });
        return copy(r);
      }
      try {
        await launch(r);
      } catch (e) {
        runs.delete(r.state.id);
        throw e;
      }
      return copy(r);
    },

    get(id) {
      const r = runs.get(id);
      return r ? copy(r) : undefined;
    },

    active() {
      return [...runs.values()].filter((r) => !r.ended).map(copy);
    },

    events(id, fromSeq = 0) {
      const r = runs.get(id);
      if (!r) {
        // Not in memory (finished before this server started): replay the saved transcript, if any.
        if (!/^[A-Za-z0-9-]+$/.test(id) || !existsSync(eventsFile(id)))
          throw new RunError("unknown-run", `no active or recent run ${id}`, "finished runs are listed at GET /api/v1/runs");
        const lines = readFileSync(eventsFile(id), "utf8")
          .split("\n")
          .filter((l) => l.trim())
          .flatMap((l) => {
            try {
              return [JSON.parse(l) as RunEventLine];
            } catch {
              return [];
            }
          })
          .filter((l) => l.seq >= fromSeq);
        return {
          async *[Symbol.asyncIterator]() {
            for (const l of lines) yield l;
          },
        };
      }
      return {
        async *[Symbol.asyncIterator]() {
          let next = Math.max(0, fromSeq);
          for (;;) {
            const first = r.buf[0]?.seq ?? r.nextSeq;
            if (next < first) next = first; // trimmed: the oldest kept event
            const idx = next - first;
            if (idx < r.buf.length) {
              const batch = r.buf.slice(idx);
              for (const line of batch) yield line;
              next = (batch.at(-1) as RunEventLine).seq + 1;
              continue;
            }
            if (r.ended) return;
            await new Promise<void>((res) => r.waiters.add(res));
          }
        },
      };
    },

    async cancel(id, by) {
      const r = runs.get(id);
      if (!r) throw new RunError("unknown-run", `no active or recent run ${id}`);
      if (r.ended || r.cancelledBy !== undefined) return;
      r.cancelledBy = by;
      push(r, { type: "stderr", text: `[hl] cancelled by ${by}` });
      if (r.state.status === "queued") {
        const i = waiting.indexOf(r);
        if (i >= 0) waiting.splice(i, 1);
        Object.assign(r.state, {
          status: "cancelled",
          ended: new Date().toISOString(),
          failure_class: "cancelled",
          outcome: "none",
        } satisfies Partial<RunState>);
        r.ended = true;
        wake(r);
        await ctx.emit("run.finished", { runId: id, runtime: r.state.runtime, ok: false, ...(r.state.ticket ? { ticket: r.state.ticket } : {}) });
        return;
      }
      await r.cancel?.();
    },

    async list(filter = {}) {
      const out = new Map<string, RunState>();
      for (const r of runs.values()) out.set(r.state.id, copy(r));
      const files = ctx.get("files");
      for (const p of await files.list("runs/*.json")) {
        const m = RECORD_NAME.exec(p);
        if (!m || out.has(m[1] as string)) continue;
        const raw = await readRecord(files, m[1] as string);
        if (raw) out.set(m[1] as string, recordToState(raw, m[1] as string));
      }
      let list = [...out.values()];
      if (filter.ticket) list = list.filter((s) => s.ticket === filter.ticket);
      if (filter.role) list = list.filter((s) => (s.role ?? s.agent) === filter.role);
      list.sort((a, b) => b.started.localeCompare(a.started));
      return filter.limit && filter.limit > 0 ? list.slice(0, filter.limit) : list;
    },

    async say(id, text, by) {
      const msg = text.trim();
      if (!msg) throw new RunError("bad-request", "the message is empty");
      const r = runs.get(id);
      if (!r)
        throw new RunError(
          "unknown-run",
          `no active or recent run ${id}`,
          "a finished run from an earlier server cannot take messages; hand the ticket off again",
        );
      if (r.cancelledBy !== undefined) throw new RunError("run-cancelled", `run ${id} was cancelled`, "hand the ticket off again");
      if (!r.ended && r.state.status === "running" && r.steer && r.state.capabilities?.steer) {
        try {
          await r.steer(msg);
          push(r, { type: "message", text: msg, by, delivered: "live" });
          return "live";
        } catch {
          /* the run stopped taking messages (its last turn ended): queue it */
        }
      }
      if (r.state.status === "queued") {
        // Not started yet: the message joins its prompt.
        r.opts = { ...r.opts, prompt: `${r.opts.prompt}\n\n${followUpPrompt([{ text: msg, by }])}` };
        r.state.queued_messages = (r.state.queued_messages ?? 0) + 1;
        push(r, { type: "message", text: msg, by, delivered: "queued" });
        return "queued";
      }
      r.queued.push({ text: msg, by });
      r.state.queued_messages = r.queued.length;
      push(r, { type: "message", text: msg, by, delivered: "queued" });
      // Already ended (and its own follow-up not started yet): the follow-up starts now.
      if (r.ended) {
        await followUp(r);
        wake(r);
      }
      return "queued";
    },

    async report(id, outcome, _by, opts: { activity?: boolean } = {}) {
      const r = runs.get(id);
      if (r) {
        await applyReport(r, outcome, { activity: opts.activity ?? true });
        if (r.ended) await updateRecord(id, { outcome });
        return copy(r);
      }
      const files = ctx.get("files");
      const raw = await readRecord(files, id);
      if (!raw) throw new RunError("unknown-run", `no run ${id}`);
      await updateRecord(id, { outcome });
      const state = recordToState({ ...raw, outcome }, id);
      const responsible = typeof raw.responsible === "string" ? raw.responsible : undefined;
      await writeOutcome(ctx, { ...state, responsible }, outcome, { activity: opts.activity ?? true });
      return state;
    },

    async resetSession(role, ticket) {
      await sessions.delete(role, ticket);
    },

    async diff(id) {
      const { wt } = await worktreeOf(id);
      return worktreeDiff(wt);
    },

    async merge(id, by) {
      const { state, wt } = await worktreeOf(id);
      const live = runs.get(id);
      if (live && !live.ended) return { merged: false, message: `run ${id} is still ${live.state.status}; merge when it has ended` };
      if (state.worktree?.merged) return { merged: false, message: `${wt.branch} was merged already` };
      // A run on the same ticket may still be working in that worktree.
      const busy = [...runs.values()].find((r) => !r.ended && r.state.worktree?.path === wt.path);
      if (busy) return { merged: false, message: `run ${busy.state.id} is working in ${wt.path}; merge when it has ended` };
      await commitWip(wt, `wip: ${state.ticket ?? id} (before merge)`);
      const res = await mergeWorktree(wt);
      if (!res.merged) return res;
      const worktree = { ...wt, merged: true };
      if (live) live.state.worktree = worktree;
      await updateRecord(id, { worktree });
      if (state.ticket && ctx.has("tickets")) {
        const actor = { kind: "person" as const, id: by, onBehalfOf: by };
        await ctx
          .get("tickets")
          .comment(state.ticket, `Merged ${wt.branch}: ${res.message}`, actor)
          .catch(() => {});
      }
      return res;
    },

    dispose() {
      void offRequested();
      void offDecided();
      waiting.splice(0);
      for (const r of runs.values()) if (!r.ended) void r.cancel?.();
    },
  };
  return manager;
}
