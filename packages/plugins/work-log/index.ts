// Work log: one TOML file per person per day, logs/YYYY-MM/YYYY-MM-DD.<author>.toml (Blueprint 14, F93).
// You write one sentence; this plugin owns storage, author, dedupe and hour allocation.
// Work page: `log edit`, `log remove` and `log day-hours` change one line or the stated day length of your own day file
// (dry run, stale-write check); the read models (sheets, rollups, search) live in views.ts.
import { randomBytes } from "node:crypto";
import type { Actor, Context, Person, PluginModule, TomlEmitter, VerbDef, WorkDaySheet, WorkLogEntry, WorkLogService, WorkQuickPick } from "@helmlock/core";
import { AuthorSlug, Category, IsoDate, StaleWriteError, WorkLogDay } from "@helmlock/core";
import { z } from "zod";
import {
  allocateDay,
  CATEGORIES,
  cleanText,
  DEFAULT_CATEGORY,
  DEFAULT_DAY_HOURS,
  DEFAULT_WEIGHT,
  findDuplicate,
  INTERNAL_TICKET,
  MAX_TEXT,
  roundQuarter,
  ruleError,
  SOURCE_RE,
  STEP,
} from "./rules.ts";
import { matches, parseQuery, sheetOf } from "./views.ts";

export const WORKLOG_KIND = "worklog-day";

export const worklogEmitter: TomlEmitter<WorkLogDay> = {
  kind: WORKLOG_KIND,
  schema: WorkLogDay,
  version: 1,
  order: {
    "": ["schema_version"],
    day: ["date", "author", "day_hours"],
    entry: ["id", "ticket", "category", "text", "weight", "hours", "logged", "source"],
  },
};

/** "Label|TICKET|Category|hours" (the settings list form) or a table { label, ticket, category, hours }. */
function parsePick(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const [label = "", ticket = "", category = "", hours = ""] = v.split("|").map((s) => s.trim());
  return { label, ticket: ticket || INTERNAL_TICKET, category: category || "Internal", ...(hours ? { hours: Number(hours) } : {}) };
}
const QuickPick = z.preprocess(
  parsePick,
  z.object({
    label: z.string().trim().min(1),
    ticket: z.string().trim().min(1).regex(/^\S+$/),
    category: z.string().trim().min(1),
    hours: z.number().min(STEP).max(24).optional(),
  }),
);

export const Config = z
  .object({
    day_hours: z.coerce.number().positive().max(24).default(DEFAULT_DAY_HOURS),
    /** Categories offered, in order: a subset of the six. Empty means all six. */
    categories: z.array(z.string()).default([]),
    quick_picks: z.array(QuickPick).default([]),
  })
  .loose();
export type WorkLogConfig = z.infer<typeof Config>;

const FILE_RE = /(?:^|\/)(\d{4}-\d{2}-\d{2})\.([a-z0-9][a-z0-9-]*)\.toml$/;

export function dayPath(date: string, author: string): string {
  if (!IsoDate.safeParse(date).success) throw ruleError("bad-date", `not a date (expected YYYY-MM-DD): ${date}`);
  return `logs/${date.slice(0, 7)}/${date}.${author}.toml`;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocalTime = (d: Date) => `${isoLocal(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Monday to Sunday of the week holding `date`. */
export function weekOf(date: string): { from: string; to: string } {
  const d = new Date(`${date}T12:00:00`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoLocal(monday), to: isoLocal(sunday) };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Day files written by lc-wms (no schema_version, TOML dates, author name plus slug, [day] hours) read as WorkLogDay. */
export function normalizeDay(raw: Record<string, unknown>, fallback: { date: string; author: string }): WorkLogDay {
  const day = { ...((raw.day as Record<string, unknown> | undefined) ?? {}) };
  const asDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : undefined);
  day.date = asDate(day.date) ?? fallback.date;
  const slug = typeof day.slug === "string" ? day.slug : undefined;
  const author = typeof day.author === "string" ? day.author : undefined;
  if (slug) {
    day.author = slug;
    delete day.slug;
  } else if (!author || !AuthorSlug.safeParse(author).success) day.author = author ? slugify(author) : fallback.author;
  if (day.day_hours === undefined && typeof day.hours === "number") {
    day.day_hours = day.hours;
    delete day.hours;
  }
  const entries = Array.isArray(raw.entry) ? raw.entry : [];
  const entry = entries.map((e: Record<string, unknown>) => ({
    ...e,
    logged: e.logged instanceof Date ? e.logged.toISOString() : (e.logged ?? `${day.date}T00:00:00`),
  }));
  return WorkLogDay.parse({ ...raw, schema_version: raw.schema_version ?? 1, day, entry });
}

async function personFor(ctx: Context, actor: Actor): Promise<Person> {
  const roster = ctx.get("roster");
  if (actor.onBehalfOf === ctx.get("workspace").author) return roster.current();
  const p = await roster.get(actor.onBehalfOf);
  if (!p)
    throw ruleError("unknown-author", `author "${actor.onBehalfOf}" is not in people.toml`, "add yourself to people.toml or fix author.local", "people.toml");
  return p;
}

/** The categories this workspace offers, in order (config `categories`, a subset of the six; empty = all six). */
export function categoriesOf(config: Pick<WorkLogConfig, "categories">): WorkLogEntry["category"][] {
  const picked = config.categories.map((c) => CATEGORIES.find((k) => k.toLowerCase() === c.trim().toLowerCase())).filter((c) => c !== undefined);
  return picked.length ? [...new Set(picked)] : [...CATEGORIES];
}

function normCategoryIn(value: string | undefined, allowed: readonly string[]): WorkLogEntry["category"] {
  if (!value) return (allowed.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : allowed[0]) as WorkLogEntry["category"];
  const hit = allowed.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  if (!hit) throw ruleError("worklog-category", `"${value}" is not a category`, `use one of ${allowed.join(", ")}`);
  return Category.parse(hit);
}

function checkWeight(weight: number) {
  if (!Number.isInteger(weight) || weight < 1 || weight > 5)
    throw ruleError("worklog-weight", `weight ${weight} is not 1 to 5`, "a weight is a share of the day, 1 to 5");
}
function checkHours(raw: number): number {
  const hours = roundQuarter(raw);
  if (hours < STEP || hours > 24)
    throw ruleError("worklog-hours", `${raw} h is not a fixed block between 0.25 and 24`, "use --hours only for a fixed block such as a meeting");
  return hours;
}
function checkSource(source: string | undefined) {
  if (source !== undefined && !SOURCE_RE.test(source)) throw ruleError("worklog-source", `source "${source}" is not manual or agent-run:<run id>`);
}

const newId = (taken: Set<string>) => {
  for (;;) {
    const id = `e${randomBytes(3).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
};

interface AppendInput {
  ticket?: string;
  category?: string;
  text: string;
  weight?: number;
  hours?: number;
  date?: string;
  source?: string;
}

export interface EntryPatch {
  ticket?: string;
  category?: string;
  text?: string;
  weight?: number;
  hours?: number;
}
export interface WriteOpts {
  dryRun?: boolean;
  /** The hash the caller read (WorkDaySheet.hash); a different file on disk is a stale write. */
  hash?: string;
}

/** What the Work page needs beyond WorkLogService; the server reads it from the "worklog" service. */
export interface WorkLogExtras {
  settings(): { floor: number; categories: string[]; quick_picks: WorkQuickPick[]; internal_ticket: string; max_text: number };
  /** One author's day with allocation; undefined when there is no file. */
  sheet(date: string, author: string, name?: string): Promise<WorkDaySheet | undefined>;
  /** Every day file in [from, to], optionally one author's, oldest first. */
  sheets(from: string, to: string, author?: string, names?: Record<string, string>): Promise<WorkDaySheet[]>;
  /** Author slugs with at least one day file. */
  authors(): Promise<string[]>;
  search(q: string, author?: string, limit?: number): Promise<{ total: number; hits: (WorkDaySheet["entries"][number] & { date: string; author: string })[] }>;
  edit(
    date: string,
    author: Person,
    ref: string,
    patch: EntryPatch,
    opts?: WriteOpts,
  ): Promise<{ written: boolean; file: string; entry: WorkLogEntry; before: WorkLogEntry }>;
  remove(date: string, author: Person, ref: string, opts?: WriteOpts): Promise<{ written: boolean; file: string; entry: WorkLogEntry }>;
  setDayHours(date: string, author: Person, hours: number | undefined, opts?: WriteOpts): Promise<{ written: boolean; file: string; day_hours?: number }>;
}
export type WorkLogFull = WorkLogService & WorkLogExtras;

export function createWorkLog(ctx: Context, config: WorkLogConfig): WorkLogFull {
  const files = ctx.get("files");
  const categories = categoriesOf(config);
  const floor = config.day_hours;

  const readDay = async (rel: string, fallback: { date: string; author: string }): Promise<{ data: WorkLogDay; hash: string } | undefined> => {
    if (!(await files.exists(rel))) return undefined;
    try {
      return await files.readToml<WorkLogDay>(rel, WORKLOG_KIND);
    } catch (e) {
      if ((e as { rule?: string }).rule === "schema-version") throw e;
      const raw = await files.readTomlRaw(rel);
      return { data: normalizeDay(raw.data, fallback), hash: raw.hash };
    }
  };

  const dayFiles = async (from: string, to: string, author?: string) => {
    const out: { rel: string; date: string; slug: string }[] = [];
    for (const rel of await files.list("logs/*/*.toml")) {
      const m = FILE_RE.exec(rel);
      if (!m) continue;
      const [, date, slug] = m as unknown as [string, string, string];
      if (date < from || date > to || (author && slug !== author)) continue;
      out.push({ rel, date, slug });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  };

  const sheetFor = async (rel: string, date: string, slug: string, name?: string) => {
    const got = await readDay(rel, { date, author: slug });
    return got ? sheetOf(got.data, { file: rel, hash: got.hash, name: name ?? slug, floor }) : undefined;
  };

  /** Read the author's day for a change; checks the caller's hash. */
  const forChange = async (date: string, author: Person, opts?: WriteOpts) => {
    const rel = dayPath(date, author.id);
    const existing = await readDay(rel, { date, author: author.id });
    if (opts?.hash !== undefined && opts.hash !== (existing?.hash ?? "")) throw new StaleWriteError(rel);
    return { rel, existing };
  };

  const resolve = (day: WorkLogDay, ref: string, rel: string): number => {
    const r = ref.trim();
    const pos = /^#?(\d+)$/.exec(r);
    const i = pos ? Number(pos[1]) - 1 : day.entry.findIndex((e) => e.id === r);
    if (i < 0 || i >= day.entry.length)
      throw ruleError("worklog-entry", `no entry ${JSON.stringify(ref)} in ${rel}`, "use the entry id or its position (1 is the first line)", rel);
    return i;
  };

  const save = async (rel: string, next: WorkLogDay, hash: string | undefined, dryRun?: boolean) => {
    await files.writeToml(rel, WORKLOG_KIND, WorkLogDay.parse(next), { expectHash: hash, dryRun });
    if (!dryRun) await ctx.emit("worklog.appended", { author: next.day.author, date: next.day.date, ticket: "-", skipped: false });
  };

  const svc: WorkLogFull = {
    async append(rawInput, author, opts) {
      // WorkLogEntry is a loose object, so Omit<> over it loses the named keys; restate them here.
      const input = rawInput as unknown as AppendInput;
      const date = input.date ?? isoLocal(new Date());
      const rel = dayPath(date, author.id);
      const ticket = (input.ticket ?? "-").trim() || "-";
      const text = cleanText(input.text);
      const category = normCategoryIn(input.category, categories);
      const weight = input.weight ?? DEFAULT_WEIGHT;
      checkWeight(weight);
      checkSource(input.source);
      const hours = input.hours !== undefined ? checkHours(input.hours) : undefined;

      const existing = await readDay(rel, { date, author: author.id });
      const day: WorkLogDay = existing?.data ?? { schema_version: 1, day: { date, author: author.id }, entry: [] };
      const dupe = findDuplicate(day.entry, ticket, text);
      if (dupe) {
        await ctx.emit("worklog.appended", { author: author.id, date, ticket, skipped: true });
        return { written: false, reason: "duplicate", file: rel, entry: dupe };
      }
      const taken = new Set(day.entry.map((e) => e.id).filter((x): x is string => typeof x === "string"));
      const entry: WorkLogEntry = { ...input, id: newId(taken), ticket, category, text, weight, logged: isoLocalTime(new Date()) };
      delete (entry as { date?: string }).date;
      if (hours === undefined) delete entry.hours;
      else entry.hours = hours;
      if (input.source === undefined) delete entry.source;
      const next = WorkLogDay.parse({ ...day, entry: [...day.entry, entry] });
      await files.writeToml(rel, WORKLOG_KIND, next, { expectHash: existing?.hash, dryRun: opts?.dryRun });
      if (!opts?.dryRun) await ctx.emit("worklog.appended", { author: author.id, date, ticket, skipped: false });
      return { written: !opts?.dryRun, ...(opts?.dryRun ? { reason: "dry-run" } : {}), file: rel, entry };
    },

    async day(date, author) {
      return (await readDay(dayPath(date, author), { date, author }))?.data;
    },

    async range(from, to, author) {
      const out: (WorkLogEntry & { date: string; author: string; hours_alloc: number })[] = [];
      for (const f of await dayFiles(from, to, author)) {
        const got = await readDay(f.rel, { date: f.date, author: f.slug });
        if (!got) continue;
        const day = got.data;
        const alloc = allocateDay(day.entry, floor, typeof day.day.day_hours === "number" ? day.day.day_hours : undefined);
        day.entry.forEach((e, i) => {
          out.push({ ...e, date: f.date, author: f.slug, hours_alloc: alloc.hours[i] ?? 0 });
        });
      }
      return out.sort((a, b) => a.date.localeCompare(b.date) || a.author.localeCompare(b.author) || a.logged.localeCompare(b.logged));
    },

    settings: () => ({
      floor,
      categories: [...categories],
      quick_picks: config.quick_picks as WorkQuickPick[],
      internal_ticket: INTERNAL_TICKET,
      max_text: MAX_TEXT,
    }),

    async sheet(date, author, name) {
      return sheetFor(dayPath(date, author), date, author, name);
    },

    async sheets(from, to, author, names) {
      const out: WorkDaySheet[] = [];
      for (const f of await dayFiles(from, to, author)) {
        const s = await sheetFor(f.rel, f.date, f.slug, names?.[f.slug]);
        if (s) out.push(s);
      }
      return out;
    },

    async authors() {
      return [...new Set((await dayFiles("0000-00-00", "9999-99-99")).map((f) => f.slug))].sort();
    },

    async search(q, author, limit = 200) {
      const terms = parseQuery(q);
      if (!terms.length) return { total: 0, hits: [] };
      const hits: (WorkDaySheet["entries"][number] & { date: string; author: string })[] = [];
      for (const f of (await dayFiles("0000-00-00", "9999-99-99", author)).reverse()) {
        const s = await sheetFor(f.rel, f.date, f.slug);
        if (!s) continue;
        for (const e of [...s.entries].reverse()) {
          if (matches(terms, { ticket: e.ticket, category: e.category, text: e.text, source: e.source, author: s.author, date: s.date }))
            hits.push({ ...e, date: s.date, author: s.author });
        }
      }
      return { total: hits.length, hits: hits.slice(0, Math.max(1, limit)) };
    },

    async edit(date, author, ref, patch, opts) {
      const { rel, existing } = await forChange(date, author, opts);
      if (!existing) throw ruleError("worklog-entry", `nothing logged by ${author.id} on ${date}`, undefined, rel);
      const day = existing.data;
      const i = resolve(day, ref, rel);
      const before = day.entry[i] as WorkLogEntry;
      const next: WorkLogEntry = { ...before };
      if (!next.id) next.id = newId(new Set(day.entry.map((e) => e.id).filter((x): x is string => typeof x === "string")));
      if (patch.ticket !== undefined) {
        const t = patch.ticket.trim();
        if (!/^\S+$/.test(t)) throw ruleError("worklog-ticket", "a ticket id, a special key such as Internal, or -");
        next.ticket = t;
      }
      if (patch.text !== undefined) next.text = cleanText(patch.text);
      if (patch.category !== undefined) next.category = normCategoryIn(patch.category, categories);
      if (patch.weight !== undefined) {
        checkWeight(patch.weight);
        next.weight = patch.weight;
        if (patch.hours === undefined) delete next.hours; // a weight is a share of the day: the line stops being pinned
      }
      if (patch.hours !== undefined) next.hours = checkHours(patch.hours);
      const entries = [...day.entry];
      entries[i] = next;
      await save(rel, { ...day, entry: entries }, existing.hash, opts?.dryRun);
      return { written: !opts?.dryRun, file: rel, entry: next, before };
    },

    async remove(date, author, ref, opts) {
      const { rel, existing } = await forChange(date, author, opts);
      if (!existing) throw ruleError("worklog-entry", `nothing logged by ${author.id} on ${date}`, undefined, rel);
      const day = existing.data;
      const i = resolve(day, ref, rel);
      const entry = day.entry[i] as WorkLogEntry;
      const entries = day.entry.filter((_, k) => k !== i);
      await save(rel, { ...day, entry: entries }, existing.hash, opts?.dryRun);
      return { written: !opts?.dryRun, file: rel, entry };
    },

    async setDayHours(date, author, hours, opts) {
      const { rel, existing } = await forChange(date, author, opts);
      const day: WorkLogDay = existing?.data ?? { schema_version: 1, day: { date, author: author.id }, entry: [] };
      const nextDay = { ...day.day };
      if (hours === undefined) delete nextDay.day_hours;
      else nextDay.day_hours = hours;
      await save(rel, { ...day, day: nextDay }, existing?.hash, opts?.dryRun);
      return { written: !opts?.dryRun, file: rel, ...(hours !== undefined ? { day_hours: hours } : {}) };
    },
  };
  return svc;
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;
const fmtH = (h: number) => `${h.toFixed(2)}h`;
const full = (ctx: Context) => ctx.get("worklog") as WorkLogFull;

function verbs(): VerbDef[] {
  const logWork = verb({
    id: "log-work",
    summary: "Log one plain sentence of work for today on a ticket (or - for none). The tool owns author, file, dedupe and hours.",
    examples: [
      'hl log-work T-014-sa "Chose TOML for records and wrote the format map" --weight 3',
      'hl log-work Internal "Daily scrum" --hours 0.5 --category Internal',
      'hl log-work - "Reviewed the release checklist" --category "Code Review"',
    ],
    args: ["ticket", "text"],
    input: z.object({
      ticket: z.string().trim().min(1).regex(/^\S+$/, "a ticket id, a special key such as Internal, or -"),
      text: z.string(),
      category: z.string().optional(),
      weight: z.coerce.number().int().min(1).max(5).optional(),
      hours: z.coerce.number().positive().max(24).optional(),
      date: IsoDate.optional(),
      source: z.string().optional(),
    }),
    writes: true,
    async run(v, input) {
      const person = await personFor(v.ctx, v.actor);
      const res = await v.ctx.get("worklog").append(input as unknown as Parameters<WorkLogService["append"]>[0], person, { dryRun: v.dryRun });
      const what = `${res.entry.ticket}  ${res.entry.category}  ${res.entry.text}`;
      const text =
        res.reason === "duplicate"
          ? `skipped (duplicate of an entry already logged today): ${what}`
          : `${v.dryRun ? "would log" : "logged"} ${what}  -> ${res.file}`;
      return { ok: true, data: res, text };
    },
  });

  const show = verb({
    id: "log show",
    summary: "Show the work log with allocated hours: today by default, or this week.",
    examples: ["hl log show", "hl log show --week", "hl log show --week --author sam --json"],
    input: z.object({ week: flag, author: z.string().optional(), date: IsoDate.optional(), all: flag }),
    writes: false,
    async run(v, input) {
      const date = input.date ?? isoLocal(new Date());
      const { from, to } = input.week ? weekOf(date) : { from: date, to: date };
      let author = input.author;
      if (!author && !input.all) author = (await personFor(v.ctx, v.actor)).id;
      const rows = await v.ctx.get("worklog").range(from, to, author);
      const total = rows.reduce((s, r) => s + r.hours_alloc, 0);
      const lines: string[] = [`${from === to ? from : `${from} to ${to}`}${author ? `  ${author}` : ""}  total ${fmtH(total)}`];
      let last = "";
      for (const r of rows) {
        const head = `${r.date} ${r.author}`;
        if (head !== last) lines.push(head);
        last = head;
        lines.push(
          `  ${fmtH(r.hours_alloc).padStart(6)}${r.hours !== undefined ? "*" : " "} ${(r.id ?? "").padEnd(8)} ${r.ticket.padEnd(11)} ${r.category.padEnd(13)} ${r.text}`,
        );
      }
      if (!rows.length) lines.push("  nothing logged");
      return { ok: true, data: { from, to, author: author ?? null, total, entries: rows }, text: lines.join("\n") };
    },
  });

  const hash = z.string().optional();
  const edit = verb({
    id: "log edit",
    summary: "Change one line of your own day file: text, category, ticket, weight (unpins) or hours (pins). The entry is its id or position.",
    examples: [
      'hl log edit 2026-10-07 e1a2b3c --text "Wrote the format map and the reader"',
      "hl log edit 2026-10-07 2 --hours 1.5",
      "hl log edit 2026-10-07 e1a2b3c --weight 4 --category Testing",
    ],
    args: ["date", "entry"],
    input: z.object({
      date: IsoDate,
      entry: z.coerce.string().trim().min(1),
      text: z.string().optional(),
      category: z.string().optional(),
      ticket: z.string().optional(),
      weight: z.coerce.number().int().min(1).max(5).optional(),
      hours: z.coerce.number().positive().max(24).optional(),
      hash,
    }),
    writes: true,
    async run(v, input) {
      const person = await personFor(v.ctx, v.actor);
      const { date, entry, hash: h, ...patch } = input;
      if (!Object.values(patch).some((x) => x !== undefined))
        throw ruleError("worklog-edit", "nothing to change", "pass --text, --category, --ticket, --weight or --hours");
      const res = await full(v.ctx).edit(date, person, entry, patch, { dryRun: v.dryRun, ...(h !== undefined ? { hash: h } : {}) });
      return {
        ok: true,
        data: { ...res, id: res.entry.id },
        text: `${v.dryRun ? "would change" : "changed"} ${res.entry.ticket}  ${res.entry.category}  ${res.entry.text}  -> ${res.file}`,
      };
    },
  });

  const remove = verb({
    id: "log remove",
    summary: "Remove one line of your own day file. The entry is its id or position.",
    examples: ["hl log remove 2026-10-07 e1a2b3c", "hl log remove 2026-10-07 3 --dry-run"],
    args: ["date", "entry"],
    input: z.object({ date: IsoDate, entry: z.coerce.string().trim().min(1), hash }),
    writes: true,
    async run(v, input) {
      const person = await personFor(v.ctx, v.actor);
      const res = await full(v.ctx).remove(input.date, person, input.entry, { dryRun: v.dryRun, ...(input.hash !== undefined ? { hash: input.hash } : {}) });
      return { ok: true, data: res, text: `${v.dryRun ? "would remove" : "removed"} ${res.entry.ticket}  ${res.entry.text}  -> ${res.file}` };
    },
  });

  const dayHours = verb({
    id: "log day-hours",
    summary: "State how long your day was (a floor, not a cap: longer days show as overtime). 0 clears it back to the floor.",
    examples: ["hl log day-hours 2026-10-07 10.5", "hl log day-hours 2026-10-07 0"],
    args: ["date", "hours"],
    input: z.object({ date: IsoDate, hours: z.coerce.number().min(0).max(24), hash }),
    writes: true,
    async run(v, input) {
      const person = await personFor(v.ctx, v.actor);
      const hours = input.hours === 0 ? undefined : checkHours(input.hours);
      const res = await full(v.ctx).setDayHours(input.date, person, hours, { dryRun: v.dryRun, ...(input.hash !== undefined ? { hash: input.hash } : {}) });
      return {
        ok: true,
        data: res,
        text: `${v.dryRun ? "would set" : "set"} ${input.date} ${hours === undefined ? "back to the floor" : `to ${hours} h`}  -> ${res.file}`,
      };
    },
  });
  return [logWork, show, edit, remove, dayHours];
}

const plugin: PluginModule<typeof Config> = {
  name: "work-log",
  requires: ["files", "verbs", "workspace", "roster"],
  Config,
  async apply(ctx, config) {
    await ctx.effect(() => ctx.get("files").registerEmitter(worklogEmitter));
    ctx.provide("worklog", createWorkLog(ctx, config));
    for (const def of verbs()) await ctx.effect(() => ctx.get("verbs").register(def));
  },
};

export default plugin;
