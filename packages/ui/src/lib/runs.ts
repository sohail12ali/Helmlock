import type { RunSummary } from "@helmlock/core/contracts";

export type RunState = "running" | "succeeded" | "failed" | "no-op";

/** A run that did nothing is labelled, so wasted wake-ups are obvious (F134). */
export function runState(r: RunSummary): RunState {
  if (!r.ended) return "running";
  if (r.ok === false) return "failed";
  if (r.first_result_line && /^no-?op\b/i.test(r.first_result_line)) return "no-op";
  return "succeeded";
}

export function runTokens(r: RunSummary): number | undefined {
  return r.usage ? r.usage.input_tokens + r.usage.output_tokens : undefined;
}
