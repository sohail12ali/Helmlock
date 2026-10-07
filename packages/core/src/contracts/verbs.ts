// FROZEN CONTRACT (milestone 1). One verb registry for CLI, hooks, assistant and Telegram (F13a).
import type { z } from "zod";
import type { Context } from "./kernel.ts";

export interface Actor {
  kind: "person" | "agent";
  /** Person slug, or agent role (e.g. "builder"). */
  id: string;
  /** The person accountable for this call (F70, F98). */
  onBehalfOf: string;
}

export interface VerbCtx {
  ctx: Context;
  actor: Actor;
  dryRun: boolean;
  json: boolean;
  cwd: string;
  /** True when stdin/stdout are a terminal; prompts are allowed only then. */
  interactive: boolean;
}

export interface VerbError {
  /** Stable rule id, e.g. "gate:blocking-questions", "claim-conflict", "unknown-author". */
  rule: string;
  message: string;
  file?: string;
  fix?: string;
}

/** A failure may carry data too (e.g. validate findings, gate reasons) so --json and the console can show them. */
export type VerbResult<O = unknown> = { ok: true; data: O; text?: string } | { ok: false; code: 1 | 2; error: VerbError; data?: unknown };

export interface VerbDef<I extends z.ZodType = z.ZodType, O = unknown> {
  /** "ticket move", "log-work", "where": noun then verb, space separated. */
  id: string;
  summary: string;
  /** Shown in --help; at least one. */
  examples: readonly string[];
  /** Positional argument names, mapped onto input keys in order. A trailing "...rest" collects the remainder. */
  args?: readonly string[];
  input: I;
  /** Writes support --dry-run and append an activity line. */
  writes: boolean;
  /** Only for flags that are not plain input keys (e.g. repeatable options). */
  repeatable?: readonly string[];
  run(v: VerbCtx, input: z.infer<I>): Promise<VerbResult<O>>;
}

export interface VerbsService {
  register(def: VerbDef): () => void;
  get(id: string): VerbDef | undefined;
  list(): VerbDef[];
  /** Runs the verb-pre/post hooks and guards, validates input, maps errors to codes. */
  run(id: string, rawInput: Record<string, unknown>, v: Omit<VerbCtx, "ctx"> & { ctx?: Context }): Promise<VerbResult>;
}

export const ok = <O>(data: O, text?: string): VerbResult<O> => (text === undefined ? { ok: true, data } : { ok: true, data, text });
export const fail = (rule: string, message: string, extra: Partial<VerbError> = {}): VerbResult<never> => ({
  ok: false,
  code: 1,
  error: { rule, message, ...extra },
});
export const blocked = (rule: string, message: string, extra: Partial<VerbError> = {}): VerbResult<never> => ({
  ok: false,
  code: 2,
  error: { rule, message, ...extra },
});
