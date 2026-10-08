// Run helpers shared by the crew views and the assistant panel (recovery flags, silence, ordering, input previews).
import type { RunSummary } from "@helmlock/core/contracts";

/** Failure classes after which bounded recovery (F65) stops and a person must step in. */
const RECOVERY = new Set(["stalled", "timeout", "process_lost", "max_turns", "unknown_session", "poisoned_session", "output_cap", "unclassified"]);

export function needsRecovery(r: Pick<RunSummary, "ended" | "ok" | "failure_class">): boolean {
  return !!r.ended && r.ok === false && !!r.failure_class && RECOVERY.has(r.failure_class);
}

/** F65: silent at 5 and 15 minutes without output. */
export function silentFor(lastEventMs: number | undefined, now: number): 0 | 5 | 15 {
  if (lastEventMs === undefined) return 0;
  const min = (now - lastEventMs) / 60_000;
  return min >= 15 ? 15 : min >= 5 ? 5 : 0;
}

/** Running first (newest first), then the rest newest first. */
export function sortRuns<T extends { ended?: string; started: string }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => Number(!!a.ended) - Number(!!b.ended) || b.started.localeCompare(a.started));
}

/** A short, single-line preview of a tool input. */
export function previewInput(input: unknown, max = 140): string {
  if (input === undefined || input === null) return "";
  let s: string;
  if (typeof input === "string") s = input;
  else if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const first = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.query ?? o.description;
    s = typeof first === "string" ? first : JSON.stringify(input);
  } else s = String(input);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
