// Read models of the Work page, built from day files with the same allocation as `hl log show` (allocateDay).
// Grouping follows lc-wms summarise (ticket first, then category); search follows lc-wms _parse_query/_matches.
import type { WorkDaySheet, WorkEntryView, WorkLogDay, WorkRangeView } from "@helmlock/core";
import { allocateDay } from "./rules.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The id a line is addressed by: its stable id, or "#<1-based position>" for lines written before ids. */
export const entryRef = (e: { id?: string }, index: number) => (typeof e.id === "string" && e.id ? e.id : `#${index + 1}`);

export function sheetOf(day: WorkLogDay, o: { file: string; hash: string; name: string; floor: number }): WorkDaySheet {
  const stated = typeof day.day.day_hours === "number" ? day.day.day_hours : undefined;
  const a = allocateDay(day.entry, o.floor, stated);
  const entries: WorkEntryView[] = day.entry.map((e, i) => {
    const v: WorkEntryView = {
      index: i,
      id: entryRef(e, i),
      ticket: e.ticket,
      category: e.category,
      text: e.text,
      hours_alloc: a.hours[i] ?? 0,
      pinned: e.hours !== undefined,
      logged: e.logged,
    };
    if (e.weight !== undefined) v.weight = e.weight;
    if (e.hours !== undefined) v.hours = e.hours;
    if (typeof e.source === "string") v.source = e.source;
    return v;
  });
  const tickets = new Map<string, { ticket: string; hours: number; pinned: boolean; cats: Map<string, { hours: number; lines: string[] }> }>();
  const cats = new Map<string, number>();
  for (const e of entries) {
    const t = tickets.get(e.ticket) ?? { ticket: e.ticket, hours: 0, pinned: false, cats: new Map() };
    t.hours = r2(t.hours + e.hours_alloc);
    t.pinned ||= e.pinned;
    const c = t.cats.get(e.category) ?? { hours: 0, lines: [] };
    c.hours = r2(c.hours + e.hours_alloc);
    c.lines.push(e.text);
    t.cats.set(e.category, c);
    tickets.set(e.ticket, t);
    cats.set(e.category, r2((cats.get(e.category) ?? 0) + e.hours_alloc));
  }
  const sheet: WorkDaySheet = {
    date: day.day.date,
    author: day.day.author,
    name: o.name,
    file: o.file,
    hash: o.hash,
    floor: a.floor,
    total: a.total,
    billable: a.billable,
    internal: a.internal,
    pinned: a.pinned,
    length: a.length,
    shortfall: a.shortfall,
    overtime: a.overtime,
    inferred_length: a.inferred_length,
    entries,
    tickets: [...tickets.values()]
      .sort((x, y) => y.hours - x.hours || x.ticket.localeCompare(y.ticket))
      .map((t) => ({
        ticket: t.ticket,
        hours: t.hours,
        pinned: t.pinned,
        categories: [...t.cats.entries()].map(([category, c]) => ({ category, ...c })).sort((x, y) => y.hours - x.hours),
      })),
    categories: [...cats.entries()].map(([category, hours]) => ({ category, hours })).sort((x, y) => y.hours - x.hours),
  };
  if (stated !== undefined) sheet.day_hours = stated;
  return sheet;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Every date from start to end inclusive (local calendar). */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00`);
  for (let i = 0; i < 400; i++) {
    const s = iso(d);
    if (s > end) break;
    out.push(s);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Rollups over a set of day sheets (control-center range_summary): by day, ticket, category and author. */
export function rangeOf(sheets: WorkDaySheet[], start: string, end: string, author: string | null): WorkRangeView {
  const add = (m: Map<string, number>, k: string, h: number) => m.set(k, r2((m.get(k) ?? 0) + h));
  const byDay = new Map<string, number>();
  const byTicket = new Map<string, number>();
  const byCat = new Map<string, number>();
  const byAuthor = new Map<string, number>();
  const cells = new Map<string, { date: string; author: string; ticket: string; hours: number }>();
  for (const d of datesBetween(start, end)) byDay.set(d, 0);
  for (const s of sheets) {
    add(byDay, s.date, s.total);
    add(byAuthor, s.author, s.total);
    for (const e of s.entries) {
      add(byTicket, e.ticket, e.hours_alloc);
      add(byCat, e.category, e.hours_alloc);
      const k = `${s.date}\0${s.author}\0${e.ticket}`;
      const c = cells.get(k) ?? { date: s.date, author: s.author, ticket: e.ticket, hours: 0 };
      c.hours = r2(c.hours + e.hours_alloc);
      cells.set(k, c);
    }
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].map(([key, hours]) => ({ key, hours })).sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key));
  const logged = [...new Set(sheets.filter((s) => s.entries.length).map((s) => s.date))].sort();
  const span = logged.length ? datesBetween(logged[0]!, logged[logged.length - 1]!).length : 0;
  return {
    start,
    end,
    author,
    total: r2(sheets.reduce((n, s) => n + s.total, 0)),
    days_logged: logged.length,
    files: sheets.length,
    span_days: span,
    by_day: [...byDay.entries()].map(([key, hours]) => ({ key, hours })).sort((a, b) => a.key.localeCompare(b.key)),
    by_ticket: sorted(byTicket),
    by_category: sorted(byCat),
    by_author: sorted(byAuthor),
    days: sheets
      .map((s) => ({
        date: s.date,
        author: s.author,
        total: s.total,
        ...(s.day_hours !== undefined ? { day_hours: s.day_hours } : {}),
        shortfall: s.shortfall,
        overtime: s.overtime,
        inferred_length: s.inferred_length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.author.localeCompare(b.author)),
    cells: [...cells.values()].sort((a, b) => a.date.localeCompare(b.date) || a.author.localeCompare(b.author) || a.ticket.localeCompare(b.ticket)),
  };
}

// ---------- search ----------

const SEARCH_KEYS: Record<string, SearchField> = {
  ticket: "ticket",
  t: "ticket",
  cat: "category",
  category: "category",
  who: "author",
  author: "author",
  date: "date",
  on: "date",
  text: "text",
  src: "source",
  source: "source",
};
export type SearchField = "ticket" | "category" | "author" | "date" | "text" | "source";
export interface SearchTerm {
  field: SearchField | "";
  value: string;
  negated: boolean;
}

/** Whitespace-separated terms, ANDed; `field:value` narrows to one field; `-term` excludes. */
export function parseQuery(q: string): SearchTerm[] {
  const out: SearchTerm[] = [];
  for (const raw of (q ?? "").split(/\s+/).filter(Boolean)) {
    const negated = raw.startsWith("-") && raw.length > 1;
    const tok = negated ? raw.slice(1) : raw;
    const i = tok.indexOf(":");
    const key = i > 0 ? tok.slice(0, i).toLowerCase() : "";
    const value = i > 0 ? tok.slice(i + 1) : "";
    const field = SEARCH_KEYS[key];
    if (field && value) out.push({ field, value: value.toLowerCase(), negated });
    else out.push({ field: "", value: tok.toLowerCase(), negated });
  }
  return out;
}

export function matches(terms: SearchTerm[], row: Record<SearchField, string | undefined>): boolean {
  const hay = Object.values(row).filter(Boolean).join(" ").toLowerCase();
  for (const t of terms) {
    const hit = (t.field ? String(row[t.field] ?? "").toLowerCase() : hay).includes(t.value);
    if (hit === t.negated) return false;
  }
  return true;
}
