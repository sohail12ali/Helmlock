// The run record runs/<run-id>.json (gitignored, B25), shared by `hl run` and the run manager.
import type { FileLayer, RunEvent, RunOptions } from "@helmlock/core";

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
  /** Where a server-started run came from ("console", "telegram:<chat id>"); absent for `hl run`. */
  origin?: string;
  /** The person accountable for the run (the actor's on_behalf_of, Blueprint 31). */
  responsible?: string;
  /** Logins and keys come from this machine (.env, workspace.local.toml, the CLI's own login), never from an agent. */
  credentials?: "this machine";
}

/** Stamps who is responsible for a run; credentials are always this machine's. */
export function stampResponsible(record: RunRecord, slug: string | undefined): RunRecord {
  if (slug) record.responsible = slug;
  record.credentials = "this machine";
  return record;
}

/** Folds a run's events into what the record needs. */
export class RunTally {
  usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: null as number | null };
  result: Extract<RunEvent, { type: "result" }> | undefined;
  sessionId: string | undefined;
  add(ev: RunEvent): void {
    if (ev.type === "init" && ev.sessionId) this.sessionId = ev.sessionId;
    if (ev.type === "usage") {
      this.usage.input_tokens += ev.inputTokens;
      this.usage.output_tokens += ev.outputTokens;
      this.usage.cache_read_tokens += ev.cacheReadTokens ?? 0;
      this.usage.cache_write_tokens += ev.cacheWriteTokens ?? 0;
      if (ev.costUsd !== undefined) this.usage.cost_usd = (this.usage.cost_usd ?? 0) + ev.costUsd;
    }
    if (ev.type === "result") this.result = ev;
  }
}

export function firstLine(text: string | undefined): string {
  return (
    (text ?? "")
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 300) ?? ""
  );
}

export function buildRecord(
  id: string,
  runtime: string,
  opts: RunOptions,
  started: string,
  done: { ok: boolean; exitCode: number | null; timedOut: boolean },
  tally: RunTally,
  failureOverride?: string,
): RunRecord {
  return {
    id,
    ticket: opts.ticket ?? null,
    runtime,
    agent: opts.agent ?? null,
    mode: opts.mode,
    model: opts.model ?? null,
    cwd: opts.cwd,
    started,
    ended: new Date().toISOString(),
    ok: done.ok,
    exit_code: done.exitCode,
    timed_out: done.timedOut,
    session_id: tally.result?.sessionId ?? tally.sessionId ?? null,
    usage: tally.usage,
    failure_class: done.ok ? null : (failureOverride ?? tally.result?.failureClass ?? "unclassified"),
    first_result_line: firstLine(tally.result?.text),
  };
}

/** Writes runs/<id>.json (and runs/.gitignore the first time); returns the relative path. */
export async function writeRunRecord(files: FileLayer, record: RunRecord): Promise<string> {
  if (!(await files.exists("runs/.gitignore"))) await files.writeText("runs/.gitignore", "*\n");
  const file = `runs/${record.id}.json`;
  await files.writeText(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
