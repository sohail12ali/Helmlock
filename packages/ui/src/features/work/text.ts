// Pure helpers of the Work page: the sentence rules (a mirror of the log-work verb's, for live validation), the
// category palette, date steps, and the two copyable texts (lc-wms timesheet summary, standup).
import type { TicketCard, WorkDaySheet } from "@helmlock/core/contracts";

export const MAX_TEXT = 160;
export const DEFAULT_CATEGORIES = ["Development", "Code Review", "Testing", "Design", "Documentation", "Internal"] as const;

const BANNED_SYMBOLS = /[;:|*#—–'‘’`]/;
const BANNED_WORDS = new Set([
  "agent",
  "agents",
  "subagent",
  "subagents",
  "skill",
  "skills",
  "claude",
  "cursor",
  "codex",
  "copilot",
  "chatgpt",
  "gpt",
  "llm",
  "dispatcher",
  "analyst",
  "planner",
  "builder",
  "verifier",
  "fixer",
  "deployer",
]);

/** Why the server would refuse this sentence (same rules as the verb), or undefined when it is fine. */
export function textProblem(text: string): string | undefined {
  const t = text.split(/\s+/).filter(Boolean).join(" ");
  if (!t) return undefined;
  if (t.length > MAX_TEXT) return `Shorten to ${MAX_TEXT} characters: one plain sentence.`;
  const sym = BANNED_SYMBOLS.exec(t);
  if (sym) return `No "${sym[0]}": the timesheet takes no ; : | * # dashes or apostrophes. Join clauses with "and".`;
  const hit = (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).find((w) => BANNED_WORDS.has(w));
  if (hit) return `No "${hit}": say what was done, not which tool or agent did it.`;
  return undefined;
}

/** Fixed category palette (control-center --cat-1..6); anything else is --cat-other. */
const CAT_INDEX: Record<string, number> = { Development: 1, "Code Review": 2, Testing: 3, Design: 4, Documentation: 5, Internal: 6 };
export const catVar = (category: string) => (CAT_INDEX[category] ? `var(--cat-${CAT_INDEX[category]})` : "var(--cat-other)");
/** Series colour by position, for charts whose keys are not categories (tickets, authors). */
export const seriesVar = (i: number) => (i < 6 ? `var(--cat-${i + 1})` : "var(--cat-other)");

/** Hours as "7.5h" (two decimals at most, no trailing zeros). */
export const fmtH = (h: number) => `${Number(h.toFixed(2))}h`;

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export function monthEnd(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return iso(d);
}
export function addMonths(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return iso(d);
}
export const isWeekend = (date: string) => {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 || day === 6;
};
/** The working day before `date` (Friday for a Monday). */
export function previousWorkday(date: string): string {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
export const weekdayShort = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

const g = (n: number) => String(Number(n.toFixed(2)));

/** The plain timesheet text of lc-wms render(): no symbols the corporate form rejects. */
export function timesheetText(sheets: WorkDaySheet[]): string {
  const out: string[] = [];
  for (const b of sheets) {
    if (out.length) out.push("");
    out.push("Work summary", `Date ${b.date}`, `Author ${b.name}`, `Total hours ${g(b.total)}`, "");
    if (b.internal) {
      out.push(`Billable hours ${g(b.billable)}`, `Internal hours ${g(b.internal)} vault only excluded from the contractual minimum`, "");
    }
    for (const t of b.tickets) {
      out.push(`Ticket ${t.ticket}`, `Hours ${g(t.hours)}`);
      for (const c of t.categories) {
        out.push(c.category);
        for (const line of c.lines) out.push(`- ${line}`);
      }
      out.push("");
    }
    if (b.shortfall) out.push(`Unaccounted hours ${g(b.shortfall)} add an entry to cover the rest of the day`);
    if (b.overtime) out.push(`Overtime hours ${g(b.overtime)} beyond the ${g(b.floor)} hour minimum`);
    if (b.inferred_length)
      out.push("Day length not stated the pinned hours already fill it so the remaining entries carry a placeholder set it with day-hours");
    out.push(`Total hours ${g(b.total)}`);
  }
  return out.length ? `${out.join("\n").trimEnd()}\n` : "No work logged.\n";
}

const OPEN_STAGES_DONE = new Set(["done"]);

/** Yesterday / Today / Blockers from the log, my open tickets and their blocked flags. */
export function standupText(o: { date: string; me: string; yesterday?: WorkDaySheet; today?: WorkDaySheet; tickets: TicketCard[] }): string {
  const lines = (s?: WorkDaySheet) => (s?.entries ?? []).map((e) => `- ${e.ticket === "-" ? "" : `${e.ticket} `}${e.text}`);
  const mine = o.tickets.filter((t) => (t.owner === o.me || t.claimed_by === o.me) && !OPEN_STAGES_DONE.has(t.stage));
  const loggedToday = new Set((o.today?.entries ?? []).map((e) => e.ticket));
  const todayLines = [...lines(o.today), ...mine.filter((t) => !t.blocked && !loggedToday.has(t.id)).map((t) => `- ${t.id} ${t.title} (${t.stage})`)];
  const blockers = mine.filter((t) => t.blocked).map((t) => `- ${t.id} ${t.title}${t.blocked_by ? ` blocked by ${t.blocked_by}` : " blocked"}`);
  const yday = lines(o.yesterday);
  return [
    `Standup ${o.date}`,
    "",
    `Yesterday${o.yesterday ? ` (${o.yesterday.date})` : ""}`,
    ...(yday.length ? yday : ["- Nothing logged"]),
    "",
    "Today",
    ...(todayLines.length ? todayLines : ["- Nothing planned yet"]),
    "",
    "Blockers",
    ...(blockers.length ? blockers : ["- None"]),
    "",
  ].join("\n");
}
