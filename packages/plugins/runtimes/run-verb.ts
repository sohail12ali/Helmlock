// `hl run "<task>"`: start one agent run, stream its events, write runs/<run-id>.json (gitignored, B25).
import { delimiter, resolve } from "node:path";
import type { RunEvent, RunOptions, VerbDef, VerbResult } from "@helmlock/core";
import { z } from "zod";
import { agentNotice } from "../harness/layers.ts";
import { newRunId } from "./process-run.ts";
import { RUNTIME_ALIASES } from "./registry.ts";
import { buildRecord, RunTally, stampResponsible, writeRunRecord } from "./run-record.ts";
import { takeReportFile, writeOutcome } from "./run-report.ts";

/** Windows names it "Path"; reuse the existing key so the child does not get two. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/** The knowledge repo's hl launcher on PATH, so the agent can call `hl` like the rulebook says. */
export function baseRunEnv(root: string): Record<string, string> {
  return { [PATH_KEY]: `${root}${delimiter}${process.env[PATH_KEY] ?? ""}`, HL_WORKSPACE: root };
}

/** Every workspace folder except the run's own cwd. */
export function defaultAddDirs(folders: readonly { path: string }[], cwd: string): string[] {
  return folders.map((f) => f.path).filter((p) => resolve(p) !== cwd);
}

export const MODES = ["plan", "ask", "auto-review", "force"] as const;

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));
const seconds = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .optional()
  .transform((v) => (v === undefined ? undefined : Number(v)));

export const RunInput = z.object({
  task: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join(" ") : v).trim())
    .pipe(z.string().min(1, "say what to do")),
  runtime: z.string().optional(),
  agent: z.string().optional(),
  ticket: z.string().optional(),
  mode: z.enum(MODES).default("plan"),
  model: z.string().optional(),
  cwd: z.string().optional(),
  add_dir: list,
  resume: z.string().optional(),
  timeout_sec: seconds,
  silence_sec: seconds,
});

export type { RunRecord } from "./run-record.ts";

export interface RunVerbOptions {
  defaultRuntime?: string;
  defaultSilenceSec?: number;
  /** Where streamed output goes; default process.stdout / process.stderr. */
  out?: (s: string) => void;
  err?: (s: string) => void;
}

function short(v: unknown): string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url ?? o.description;
  const s = typeof pick === "string" ? pick : v === undefined ? "" : JSON.stringify(v);
  return s.length > 100 ? `${s.slice(0, 97)}...` : s;
}

export function textLine(ev: RunEvent): string | undefined {
  switch (ev.type) {
    case "text":
      return ev.text.endsWith("\n") ? ev.text : `${ev.text}\n`;
    case "tool":
      if (ev.phase === "start") return `  > ${ev.name} ${short(ev.input)}\n`;
      return ev.isError ? `  ! ${ev.name} failed\n` : undefined;
    default:
      return undefined;
  }
}

export function createRunVerb(o: RunVerbOptions = {}): VerbDef<typeof RunInput> {
  const out = o.out ?? ((s: string) => void process.stdout.write(s));
  const err = o.err ?? ((s: string) => void process.stderr.write(s));
  return {
    id: "run",
    summary: "Start an agent run (Claude Code or Cursor) on a task; streams events and writes runs/<run-id>.json.",
    examples: [
      'hl run "Summarise the open questions on T-014-sa" --ticket T-014-sa',
      'hl run "Fix the failing test" --runtime cursor --agent builder --mode auto-review',
      'hl run "Plan the next slice" --json',
    ],
    args: ["...task"],
    input: RunInput,
    writes: true,
    repeatable: ["add_dir"],
    async run(v, input): Promise<VerbResult> {
      const ws = v.ctx.get("workspace");
      const runtimes = v.ctx.get("runtimes");
      const name = input.runtime ?? o.defaultRuntime ?? "claude";
      const adapter = runtimes.get(name);
      if (!adapter)
        return {
          ok: false,
          code: 1,
          error: {
            rule: "unknown-runtime",
            message: `no runtime "${name}"; registered: ${
              runtimes
                .list()
                .map((a) => a.id)
                .join(", ") || "none"
            }`,
            fix: `use --runtime ${Object.keys(RUNTIME_ALIASES).join("|")}`,
          },
        };
      const cwd = resolve(input.cwd ?? ws.root);
      const addDirs = input.add_dir.length ? input.add_dir.map((d) => resolve(d)) : defaultAddDirs(ws.folders, cwd);
      // The run id is known up front so the agent can call `hl run report` (HL_RUN_ID).
      const runId = newRunId();
      let opts: RunOptions = {
        prompt: input.task,
        cwd,
        addDirs,
        mode: input.mode,
        silenceSec: input.silence_sec ?? o.defaultSilenceSec ?? 1800,
        env: { ...baseRunEnv(ws.root), HL_RUN_ID: runId },
        runId,
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.ticket ? { ticket: input.ticket } : {}),
        ...(input.resume ? { resumeSessionId: input.resume } : {}),
        ...(input.timeout_sec ? { timeoutSec: input.timeout_sec } : {}),
      };
      opts = await v.ctx.runHook("agent/pre-run", opts);
      if (!(MODES as readonly string[]).includes(opts.mode))
        return { ok: false, code: 1, error: { rule: "bad-mode", message: `mode ${opts.mode} is not on the ladder` } };
      if (v.dryRun) return { ok: true, data: { runtime: adapter.id, options: opts }, text: `would run ${adapter.id} in ${opts.mode} mode in ${opts.cwd}` };

      // .claude/agents holds the layer winners after `hl harness sync` (Blueprint 31): say so when it is behind.
      const notice = opts.agent ? agentNotice(ws.root, ws.deliveryRoot, ws.author, opts.agent) : undefined;
      if (notice) err(`${notice}\n`);
      const started = new Date().toISOString();
      const handle = await adapter.start(opts);
      await v.ctx.emit("run.started", { runId: handle.id, runtime: adapter.id, ...(opts.ticket ? { ticket: opts.ticket } : {}) });
      const tally = new RunTally();
      const onSigint = () => void handle.cancel();
      process.once("SIGINT", onSigint);
      try {
        for await (const ev of handle.events) {
          if (v.json) out(`${JSON.stringify({ run: handle.id, ...ev })}\n`);
          else if (ev.type === "stderr") err(`${ev.text}\n`);
          else {
            const line = textLine(ev);
            if (line) out(line);
          }
          tally.add(ev);
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
      const done = await handle.done;
      const record = stampResponsible(buildRecord(handle.id, adapter.id, opts, started, done, tally), v.actor.onBehalfOf);
      // The agent's `hl run report` from inside this run waits in runs/reports/<id>.json (F154).
      const filed = await takeReportFile(v.ctx, handle.id).catch(() => undefined);
      record.outcome = filed?.outcome ?? "none";
      const file = await writeRunRecord(v.ctx.get("files"), record);
      if (filed) {
        const problems = await writeOutcome(v.ctx, { ...record, ticket: record.ticket ?? undefined, agent: record.agent ?? undefined }, filed.outcome, {
          activity: false,
        });
        for (const p of problems) err(`hl: ${p}\n`);
      }
      await v.ctx.emit("run.finished", { runId: handle.id, runtime: adapter.id, ok: done.ok, ...(opts.ticket ? { ticket: opts.ticket } : {}) });
      if (!done.ok)
        return {
          ok: false,
          code: 1,
          error: { rule: `run:${record.failure_class}`, message: `run ${handle.id} failed: ${tally.result?.text || record.failure_class}`.slice(0, 500), file },
        };
      const usage = tally.usage;
      const tokens = `${usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens} in / ${usage.output_tokens} out`;
      return {
        ok: true,
        data: record,
        text: `run ${handle.id} ok (${adapter.id}, ${opts.mode}, ${tokens}${usage.cost_usd !== null ? `, $${usage.cost_usd.toFixed(4)}` : ""}) -> ${file}`,
      };
    },
  };
}
