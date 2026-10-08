// What the machine can see a person did on a day, and nothing more (lc-wms .kanban/core/work_evidence.py).
// First and last commit across the workspace's repos (matched by the person's git spellings from people.toml) and
// the start and end of their agent runs bound a window. The window suggests a day length; a person accepts it with
// `log day-hours`. Nothing here writes.
import { spawnSync } from "node:child_process";
import type { WorkEvidence } from "@helmlock/core";
import { STEP } from "./rules.ts";

/** A span longer than this is a stray timestamp; a person types the number instead. */
export const MAX_SUGGESTED_HOURS = 16;
/** One run longer than this is a run nobody closed: counted, but it does not stretch the window. */
export const MAX_RUN_HOURS = 12;

export const CAVEAT =
  "Commit and run times bound the window they happened in. They are not a stopwatch, so anything before the first and after the last is not counted.";

export interface Commit {
  repo: string;
  hash: string;
  name: string;
  email: string;
  /** Author wall clock, offset dropped: YYYY-MM-DDTHH:MM:SS. */
  at: string;
  files: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Commits authored on `date` (author wall clock) by any of the spellings, across the given repo folders. */
export function scanGit(repos: { name: string; abs: string }[], date: string, spellings: readonly string[]): Commit[] {
  const who = new Set(spellings.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (!who.size) return [];
  const out: Commit[] = [];
  const seen = new Set<string>();
  for (const repo of repos) {
    const r = spawnSync(
      "git",
      [
        "log",
        "--all",
        "--no-merges",
        "--numstat",
        `--since=${shiftDate(date, -1)}`,
        `--until=${shiftDate(date, 2)}`,
        "--pretty=format:%x1e%H%x1f%an%x1f%ae%x1f%aI",
      ],
      { cwd: repo.abs, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 20_000 },
    );
    if (r.error || r.status !== 0 || !r.stdout) continue;
    for (const rec of r.stdout.split("\x1e")) {
      if (!rec.trim()) continue;
      const [head = "", ...rest] = rec.split(/\r?\n/);
      const [hash = "", name = "", email = "", aI = ""] = head.split("\x1f");
      const at = aI.trim().slice(0, 19);
      if (at.slice(0, 10) !== date) continue;
      if (!who.has(name.trim().toLowerCase()) && !who.has(email.trim().toLowerCase())) continue;
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ repo: repo.name, hash: hash.slice(0, 12), name, email, at, files: rest.filter((l) => /^\S+\t\S+\t/.test(l)).length });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Local wall-clock time (YYYY-MM-DDTHH:MM:SS) of an ISO instant. */
export function localStamp(isoTime: string): string | undefined {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const minutes = (stamp: string) => {
  const [h = "0", m = "0", s = "0"] = stamp.slice(11, 19).split(":");
  return Number(h) * 60 + Number(m) + Number(s) / 60;
};

/** The span rounded to the quarter and clamped to floor..16. */
export function suggestLength(spanHours: number | undefined, floor: number): number | undefined {
  if (spanHours === undefined) return undefined;
  const h = Math.round(spanHours / STEP) * STEP;
  return Math.max(floor, Math.min(MAX_SUGGESTED_HOURS, h));
}

export interface RunWindow {
  id: string;
  /** Local wall clock. */
  start: string;
  end?: string;
}

export function evidenceFor(o: { date: string; author: string; commits: Commit[]; runs: RunWindow[]; floor: number; declared?: number }): WorkEvidence {
  const points: string[] = o.commits.map((c) => c.at);
  let runHours = 0;
  for (const r of o.runs) {
    const end = r.end && r.end.slice(0, 10) === o.date ? r.end : undefined;
    const len = end ? (minutes(end) - minutes(r.start)) / 60 : 0;
    if (len > MAX_RUN_HOURS || len < 0) continue;
    runHours += len;
    points.push(r.start);
    if (end) points.push(end);
  }
  points.sort();
  const first = points[0];
  const last = points[points.length - 1];
  const span = first && last ? Math.max(0, (minutes(last) - minutes(first)) / 60) : undefined;
  const suggested = suggestLength(span, o.floor);
  const repos = [...new Set(o.commits.map((c) => c.repo))].sort();
  const files = o.commits.reduce((s, c) => s + c.files, 0);
  const reasons: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (o.commits.length)
    reasons.push(`${plural(o.commits.length, "commit")} across ${plural(repos.length, "repo")} (${repos.join(", ")}), ${plural(files, "file change")}`);
  if (o.runs.length)
    reasons.push(runHours >= STEP ? `${plural(o.runs.length, "agent run")} totalling ${Math.round(runHours * 4) / 4} h` : plural(o.runs.length, "agent run"));
  if (first && last) reasons.push(`first at ${first.slice(11, 16)}, last at ${last.slice(11, 16)}: a ${Math.round((span ?? 0) * 100) / 100} h window`);
  if (suggested !== undefined && span !== undefined) {
    const rounded = Math.round(span / STEP) * STEP;
    if (rounded < o.floor) reasons.push(`shorter than the ${o.floor} h floor, so the floor stands`);
    else if (rounded > MAX_SUGGESTED_HOURS) reasons.push(`capped at ${MAX_SUGGESTED_HOURS} h: a longer span is usually a stray timestamp`);
  }
  if (!points.length) reasons.push("no commits or agent runs found for this person on this day");
  const ev: WorkEvidence = {
    date: o.date,
    author: o.author,
    commits: o.commits.length,
    repos,
    files,
    runs: o.runs.length,
    run_hours: Math.round(runHours * 100) / 100,
    span_hours: Math.round((span ?? 0) * 100) / 100,
    floor: o.floor,
    worth_asking: suggested !== undefined && o.declared === undefined && suggested > o.floor,
    reasons,
    caveat: CAVEAT,
  };
  if (first) ev.first = first.slice(11, 16);
  if (last) ev.last = last.slice(11, 16);
  if (o.declared !== undefined) ev.declared = o.declared;
  if (suggested !== undefined) ev.suggested = suggested;
  return ev;
}
