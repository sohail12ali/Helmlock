// `hl run "<task>"`: start one agent run, stream its events, write runs/<run-id>.json (gitignored, B25).
import { resolve } from "node:path";
import type { RunEvent, RunOptions, VerbDef, VerbResult } from "@helmlock/core";
import { z } from "zod";
import { RUNTIME_ALIASES } from "./registry.ts";

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

export interface RunRecord {
  id: string;
  ticket: string | null;
  runtime: string;
  agent: string | null;
  mode: string;
  model: string | null;
  cwd: string;
  started: string;
  ended: string;
  ok: boolean;
  exit_code: number | null;
  timed_out: boolean;
  session_id: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number | null };
  failure_class: string | null;
  first_result_line: string;
}

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
      const addDirs = input.add_dir.length ? input.add_dir.map((d) => resolve(d)) : ws.folders.map((f) => f.path).filter((p) => resolve(p) !== cwd);
      let opts: RunOptions = {
        prompt: input.task,
        cwd,
        addDirs,
        mode: input.mode,
        silenceSec: input.silence_sec ?? o.defaultSilenceSec ?? 1800,
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

      const started = new Date().toISOString();
      const handle = await adapter.start(opts);
      await v.ctx.emit("run.started", { runId: handle.id, runtime: adapter.id, ...(opts.ticket ? { ticket: opts.ticket } : {}) });
      const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: null as number | null };
      let result: Extract<RunEvent, { type: "result" }> | undefined;
      let sessionId: string | undefined;
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
          if (ev.type === "init" && ev.sessionId) sessionId = ev.sessionId;
          if (ev.type === "usage") {
            usage.input_tokens += ev.inputTokens;
            usage.output_tokens += ev.outputTokens;
            usage.cache_read_tokens += ev.cacheReadTokens ?? 0;
            usage.cache_write_tokens += ev.cacheWriteTokens ?? 0;
            if (ev.costUsd !== undefined) usage.cost_usd = (usage.cost_usd ?? 0) + ev.costUsd;
          }
          if (ev.type === "result") result = ev;
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
      const done = await handle.done;
      const record: RunRecord = {
        id: handle.id,
        ticket: opts.ticket ?? null,
        runtime: adapter.id,
        agent: opts.agent ?? null,
        mode: opts.mode,
        model: opts.model ?? null,
        cwd: opts.cwd,
        started,
        ended: new Date().toISOString(),
        ok: done.ok,
        exit_code: done.exitCode,
        timed_out: done.timedOut,
        session_id: result?.sessionId ?? sessionId ?? null,
        usage,
        failure_class: done.ok ? null : (result?.failureClass ?? "unclassified"),
        first_result_line:
          (result?.text ?? "")
            .split(/\r?\n/)
            .find((l) => l.trim())
            ?.trim()
            .slice(0, 300) ?? "",
      };
      const files = v.ctx.get("files");
      if (!(await files.exists("runs/.gitignore"))) await files.writeText("runs/.gitignore", "*\n");
      const file = `runs/${handle.id}.json`;
      await files.writeText(file, `${JSON.stringify(record, null, 2)}\n`);
      await v.ctx.emit("run.finished", { runId: handle.id, runtime: adapter.id, ok: done.ok, ...(opts.ticket ? { ticket: opts.ticket } : {}) });
      if (!done.ok)
        return {
          ok: false,
          code: 1,
          error: { rule: `run:${record.failure_class}`, message: `run ${handle.id} failed: ${result?.text || record.failure_class}`.slice(0, 500), file },
        };
      const tokens = `${usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens} in / ${usage.output_tokens} out`;
      return {
        ok: true,
        data: record,
        text: `run ${handle.id} ok (${adapter.id}, ${opts.mode}, ${tokens}${usage.cost_usd !== null ? `, $${usage.cost_usd.toFixed(4)}` : ""}) -> ${file}`,
      };
    },
  };
}
