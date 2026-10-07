// The run manager (service "runManager"): agent runs started from the server (console, Telegram), F65, F97, F134.
// One active run per ticket, an identical start within 10 s coalesces, events are buffered with sequence numbers so a
// browser can replay and follow, silence is flagged at 5 and 15 minutes, cancel is a tree kill, and the run record is
// the same runs/<id>.json that `hl run` writes. Claude runs started by the server get a per-run --settings file with
// a PreToolUse hook that asks a person through the server (control-center agent_approvals.py write_settings).
import { join, resolve } from "node:path";
import type { Context, RunEvent, RunManagerService, RunMode, RunStartOptions, RunState } from "@helmlock/core";
import { type ManagedRunOptions, newRunId } from "./process-run.ts";
import { RUNTIME_ALIASES } from "./registry.ts";
import { buildRecord, RunTally, writeRunRecord } from "./run-record.ts";
import { baseRunEnv, defaultAddDirs, MODES } from "./run-verb.ts";

export const COALESCE_MS = 10_000;
export const BUFFER_CAP = 5_000;
export const SILENCE_FLAGS_MS = [5 * 60_000, 15 * 60_000] as const;
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
  key: string;
  startedAt: number;
  buf: RunEventLine[];
  nextSeq: number;
  waiters: Set<() => void>;
  ended: boolean;
  cancel?: () => Promise<void>;
  cancelledBy?: string;
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

export type RunManager = RunManagerService & { dispose(): void };

export function createRunManager(o: RunManagerOptions): RunManager {
  const { ctx } = o;
  const runs = new Map<string, Live>();
  const coalesceMs = o.coalesceMs ?? COALESCE_MS;
  const cap = o.bufferCap ?? BUFFER_CAP;
  const flags = o.silenceFlagsMs ?? SILENCE_FLAGS_MS;

  const wake = (r: Live) => {
    for (const w of [...r.waiters]) w();
    r.waiters.clear();
  };
  const push = (r: Live, event: RunEvent) => {
    r.buf.push({ seq: r.nextSeq++, ts: new Date().toISOString(), event });
    if (r.buf.length > cap) r.buf.splice(0, r.buf.length - cap);
    wake(r);
  };
  const prune = () => {
    const finished = [...runs.values()].filter((r) => r.ended);
    for (const r of finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT))) runs.delete(r.state.id);
  };

  async function launch(r: Live, opts: RunStartOptions, adapterId: string) {
    const ws = ctx.get("workspace");
    const files = ctx.get("files");
    const adapter = ctx.get("runtimes").get(adapterId);
    if (!adapter) throw new RunError("unknown-runtime", `no runtime "${adapterId}"`);
    const id = r.state.id;
    const cwd = resolve(opts.cwd ?? ws.root);
    const env: Record<string, string> = { ...baseRunEnv(ws.root), ...(opts.env ?? {}), HL_RUN_ID: id };
    let run: ManagedRunOptions = {
      prompt: opts.prompt,
      cwd,
      addDirs: opts.addDirs ?? defaultAddDirs(ws.folders, cwd),
      mode: r.state.mode,
      silenceSec: opts.silenceSec ?? o.defaultSilenceSec ?? 1800,
      env,
      runId: id,
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.ticket ? { ticket: opts.ticket } : {}),
      ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
      ...(opts.timeoutSec ? { timeoutSec: opts.timeoutSec } : {}),
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
        // post-run protected-path check are the guard.
        delete env.HL_SERVER_URL;
        delete env.HL_HOOK_TOKEN;
      }
    }
    run = (await ctx.runHook("agent/pre-run", run)) as ManagedRunOptions;
    if (run.mode === "force") throw new RunError("mode-not-allowed", 'mode "force" stays in the terminal (hl run --mode force)');

    let handle: Awaited<ReturnType<typeof adapter.start>>;
    try {
      handle = await adapter.start(run);
    } catch (e) {
      if (settingsRel) await files.remove(settingsRel).catch(() => {});
      throw e;
    }
    r.cancel = () => handle.cancel();
    if (r.cancelledBy) void handle.cancel();
    await ctx.emit("run.started", { runId: id, runtime: adapter.id, ...(run.ticket ? { ticket: run.ticket } : {}) });

    const tally = new RunTally();
    let lastOutput = Date.now();
    let flagged = 0;
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
          push(r, ev);
        }
        done = await handle.done;
      } catch (e) {
        push(r, { type: "stderr", text: `[hl] run lost: ${(e as Error).message}` });
      } finally {
        clearInterval(tick);
      }
      const cancelled = r.cancelledBy !== undefined;
      if (cancelled) done = { ...done, ok: false };
      const record = buildRecord(id, adapter.id, run, r.state.started, done, tally, cancelled ? "cancelled" : undefined);
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
      wake(r);
      await ctx.emit("run.finished", { runId: id, runtime: adapter.id, ok: done.ok, ...(run.ticket ? { ticket: run.ticket } : {}) });
      prune();
    })();
  }

  return {
    async start(opts) {
      const mode = opts.mode ?? "plan";
      if (mode === "force") throw new RunError("mode-not-allowed", 'mode "force" stays in the terminal', "use plan, ask or auto-review");
      if (!(MODES as readonly string[]).includes(mode)) throw new RunError("bad-mode", `mode ${mode} is not on the ladder`);
      const prompt = (opts.prompt ?? "").trim();
      if (!prompt) throw new RunError("bad-request", "say what to do (task is empty)");
      const key = `${opts.ticket ?? ""}\0${prompt}`;
      const now = Date.now();
      // F134: the same task on the same ticket within 10 s is one run (a double click, a retried request).
      const twin = [...runs.values()].find((r) => r.key === key && now - r.startedAt < coalesceMs);
      if (twin) return { ...twin.state };
      if (opts.ticket) {
        const busy = [...runs.values()].find((r) => !r.ended && r.state.ticket === opts.ticket);
        if (busy)
          throw new RunError(
            "run-active",
            `run ${busy.state.id} is still active on ${opts.ticket}`,
            `wait for it or cancel it (POST /api/v1/runs/${busy.state.id}/cancel)`,
          );
      }
      const name = opts.runtime ?? o.defaultRuntime ?? "claude-code";
      const runtimeId = RUNTIME_ALIASES[name] ?? name;
      const r: Live = {
        state: {
          id: newRunId(),
          runtime: runtimeId,
          mode,
          status: "running",
          started: new Date(now).toISOString(),
          ...(opts.agent ? { agent: opts.agent } : {}),
          ...(opts.ticket ? { ticket: opts.ticket } : {}),
        },
        key,
        startedAt: now,
        buf: [],
        nextSeq: 0,
        waiters: new Set(),
        ended: false,
      };
      // Reserved before any await, so two concurrent starts on one ticket cannot both pass the check.
      runs.set(r.state.id, r);
      try {
        await launch(r, { ...opts, prompt }, runtimeId);
      } catch (e) {
        runs.delete(r.state.id);
        throw e;
      }
      return { ...r.state };
    },

    get(id) {
      const r = runs.get(id);
      return r ? { ...r.state } : undefined;
    },

    active() {
      return [...runs.values()].filter((r) => !r.ended).map((r) => ({ ...r.state }));
    },

    events(id, fromSeq = 0) {
      const r = runs.get(id);
      if (!r) throw new RunError("unknown-run", `no active or recent run ${id}`, "finished runs are listed at GET /api/v1/runs");
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
      await r.cancel?.();
    },

    dispose() {
      for (const r of runs.values()) if (!r.ended) void r.cancel?.();
    },
  };
}
