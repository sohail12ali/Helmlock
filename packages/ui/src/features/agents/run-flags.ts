import type { RunEvent, RunSummary } from "@helmlock/core/contracts";

/** The six agents of the default pack (Blueprint 18). Roles only; the server resolves the definition. */
export const AGENT_ROLES = ["analyst", "planner", "builder", "verifier", "fixer", "deployer"] as const;

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

export type TranscriptItem =
  | { kind: "text"; seq: number; text: string }
  | { kind: "thinking"; seq: number; text: string }
  | { kind: "tool"; seq: number; name: string; input?: unknown; done: boolean; isError?: boolean }
  | { kind: "usage"; seq: number; event: Extract<RunEvent, { type: "usage" }> }
  | { kind: "result"; seq: number; ok: boolean; text: string; failureClass?: string }
  | { kind: "stderr"; seq: number; text: string }
  | { kind: "init"; seq: number; model?: string };

/** Fold the event lines into display items: consecutive text joins, a tool start and its end become one line. */
export function toTranscript(lines: { seq: number; event: RunEvent }[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  const openTools = new Map<string, number>();
  for (const { seq, event: e } of lines) {
    const last = out[out.length - 1];
    switch (e.type) {
      case "text":
        if (last?.kind === "text") last.text += e.text;
        else out.push({ kind: "text", seq, text: e.text });
        break;
      case "thinking":
        if (last?.kind === "thinking") last.text += e.text;
        else out.push({ kind: "thinking", seq, text: e.text });
        break;
      case "tool": {
        const key = e.id ?? e.name;
        if (e.phase === "start") {
          openTools.set(key, out.length);
          out.push({ kind: "tool", seq, name: e.name, input: e.input, done: false });
        } else {
          const at = openTools.get(key);
          const item = at !== undefined ? out[at] : undefined;
          if (item?.kind === "tool") {
            item.done = true;
            item.isError = e.isError;
            openTools.delete(key);
          } else out.push({ kind: "tool", seq, name: e.name, input: e.input, done: true, isError: e.isError });
        }
        break;
      }
      case "usage":
        out.push({ kind: "usage", seq, event: e });
        break;
      case "result":
        out.push({ kind: "result", seq, ok: e.ok, text: e.text, ...(e.failureClass ? { failureClass: e.failureClass } : {}) });
        break;
      case "stderr":
        if (last?.kind === "stderr") last.text += `\n${e.text}`;
        else out.push({ kind: "stderr", seq, text: e.text });
        break;
      case "init":
        out.push({ kind: "init", seq, ...(e.model ? { model: e.model } : {}) });
        break;
      default:
        break;
    }
  }
  return out;
}
