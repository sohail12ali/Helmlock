// Suggested entries (lc-wms "draft an entry from a finished agent run"): finished runs and ticket moves of one person on
// one day that have no log line yet. A suggestion is a draft only; nothing is written until the person confirms it.
import type { ActivityLine, WorkLogEntry, WorkSuggestion } from "@helmlock/core";
import { localStamp } from "./evidence.ts";
import { MAX_TEXT } from "./rules.ts";

/** The fields of a run record (runs/<id>.json) or RunState this needs; milestone 8 adds `outcome`, which may be absent. */
export interface RunLike {
  id: string;
  ticket?: string | null;
  agent?: string | null;
  role?: string;
  started: string;
  ended?: string;
  ok?: boolean;
  status?: string;
  responsible?: string;
  first_result_line?: string;
  outcome?: { outcome?: string; summary?: string } | "none" | null;
}

/** First sentence of a text, with the symbols the timesheet will not carry taken out, cut to 160 characters. */
export function draftSentence(text: string | undefined): string {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  let s = (m ? m[1]! : flat).replace(/[.!?]+$/, "");
  s = s.replace(/[;:|]/g, ",").replace(/[*#`]/g, "").replace(/[—–]/g, " ").replace(/['‘’]/g, "").replace(/\s+/g, " ").trim();
  if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT).replace(/\s+\S*$/, "");
  return s;
}

const finished = (r: RunLike) => !!r.ended && r.status !== "running" && r.status !== "queued";

export function suggestionsFor(o: {
  date: string;
  author: string;
  runs: RunLike[];
  activity: ActivityLine[];
  entries: readonly WorkLogEntry[];
  /** Ticket titles, for drafting a sentence from a ticket move. */
  titles?: Record<string, string>;
}): WorkSuggestion[] {
  const out: WorkSuggestion[] = [];
  const sources = new Set(o.entries.map((e) => e.source).filter((s): s is string => typeof s === "string"));
  const ticketsLogged = new Set(o.entries.map((e) => e.ticket));
  for (const r of o.runs) {
    if (!finished(r)) continue;
    if (r.responsible && r.responsible !== o.author) continue;
    const start = localStamp(r.started);
    if (!start || start.slice(0, 10) !== o.date) continue;
    const source = `agent-run:${r.id}`;
    if (sources.has(source)) continue;
    const outcome = r.outcome && typeof r.outcome === "object" ? r.outcome : undefined;
    const text = draftSentence(outcome?.summary || r.first_result_line);
    const who = r.role ?? r.agent ?? "run";
    out.push({
      key: `run:${r.id}`,
      kind: "run",
      ...(r.ticket ? { ticket: r.ticket } : {}),
      text,
      source,
      at: r.ended ?? r.started,
      detail: `${who} run ${outcome?.outcome ?? (r.ok === false ? "failed" : "finished")} at ${(localStamp(r.ended ?? r.started) ?? "").slice(11, 16)}`,
    });
  }
  const moved = new Map<string, ActivityLine>();
  for (const a of o.activity) {
    if (a.on_behalf_of !== o.author || a.code !== 0 || a.dry_run) continue;
    if (a.verb !== "ticket move" && a.verb !== "ticket close") continue;
    if (!a.entity || ticketsLogged.has(a.entity)) continue;
    moved.set(a.entity, a);
  }
  for (const [ticket, a] of moved) {
    const title = o.titles?.[ticket];
    out.push({
      key: `move:${ticket}`,
      kind: "ticket-move",
      ticket,
      text: title ? draftSentence(`Worked on ${title}`) : "",
      at: a.ts,
      detail: `${a.verb === "ticket close" ? "closed" : "moved"} at ${(localStamp(a.ts) ?? "").slice(11, 16)}`,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
