// Work log: one TOML file per person per day, logs/YYYY-MM/YYYY-MM-DD.<author>.toml (Blueprint 14, F93).
// You write one sentence; this plugin owns storage, author, dedupe and hour allocation.
import type { Actor, Context, Person, PluginModule, TomlEmitter, VerbDef, WorkLogEntry, WorkLogService } from "@helmlock/core";
import { AuthorSlug, IsoDate, WorkLogDay } from "@helmlock/core";
import { z } from "zod";
import { allocate, cleanText, DEFAULT_DAY_HOURS, DEFAULT_WEIGHT, findDuplicate, normCategory, roundQuarter, ruleError, STEP } from "./rules.ts";

export const WORKLOG_KIND = "worklog-day";

export const worklogEmitter: TomlEmitter<WorkLogDay> = {
  kind: WORKLOG_KIND,
  schema: WorkLogDay,
  version: 1,
  order: {
    "": ["schema_version"],
    day: ["date", "author", "day_hours"],
    entry: ["ticket", "category", "text", "weight", "hours", "logged"],
  },
};

export const Config = z.object({ day_hours: z.coerce.number().positive().max(24).default(DEFAULT_DAY_HOURS) }).loose();

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

interface AppendInput {
  ticket?: string;
  category?: string;
  text: string;
  weight?: number;
  hours?: number;
  date?: string;
}

export function createWorkLog(ctx: Context, config: z.infer<typeof Config>): WorkLogService {
  const files = ctx.get("files");

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

  return {
    async append(rawInput, author, opts) {
      // WorkLogEntry is a loose object, so Omit<> over it loses the named keys; restate them here.
      const input = rawInput as unknown as AppendInput;
      const date = input.date ?? isoLocal(new Date());
      const rel = dayPath(date, author.id);
      const ticket = (input.ticket ?? "-").trim() || "-";
      const text = cleanText(input.text);
      const category = normCategory(input.category);
      const weight = input.weight ?? DEFAULT_WEIGHT;
      if (!Number.isInteger(weight) || weight < 1 || weight > 5)
        throw ruleError("worklog-weight", `weight ${weight} is not 1 to 5`, "a weight is a share of the day, 1 to 5");
      let hours: number | undefined;
      if (input.hours !== undefined) {
        hours = roundQuarter(input.hours);
        if (hours < STEP || hours > 24)
          throw ruleError("worklog-hours", `${input.hours} h is not a fixed block between 0.25 and 24`, "use --hours only for a fixed block such as a meeting");
      }
      const entry: WorkLogEntry = { ...input, ticket, category, text, weight, logged: isoLocalTime(new Date()) };
      delete (entry as { date?: string }).date;
      if (hours === undefined) delete entry.hours;
      else entry.hours = hours;

      const existing = await readDay(rel, { date, author: author.id });
      const day: WorkLogDay = existing?.data ?? { schema_version: 1, day: { date, author: author.id }, entry: [] };
      const dupe = findDuplicate(day.entry, ticket, text);
      if (dupe) {
        await ctx.emit("worklog.appended", { author: author.id, date, ticket, skipped: true });
        return { written: false, reason: "duplicate", file: rel, entry: dupe };
      }
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
      for (const rel of await files.list("logs/*/*.toml")) {
        const m = FILE_RE.exec(rel);
        if (!m) continue;
        const [, date, slug] = m as unknown as [string, string, string];
        if (date < from || date > to || (author && slug !== author)) continue;
        const day = (await readDay(rel, { date, author: slug }))?.data;
        if (!day) continue;
        const alloc = allocate(day.entry, day.day.day_hours ?? config.day_hours);
        day.entry.forEach((e, i) => {
          out.push({ ...e, date, author: slug, hours_alloc: alloc.hours[i] ?? 0 });
        });
      }
      return out.sort((a, b) => a.date.localeCompare(b.date) || a.author.localeCompare(b.author) || a.logged.localeCompare(b.logged));
    },
  };
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;
const fmtH = (h: number) => `${h.toFixed(2)}h`;

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
    }),
    writes: true,
    async run(v, input) {
      const person = await personFor(v.ctx, v.actor);
      const res = await v.ctx.get("worklog").append({ ...input, category: normCategory(input.category) }, person, { dryRun: v.dryRun });
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
        lines.push(`  ${fmtH(r.hours_alloc).padStart(6)}${r.hours !== undefined ? "*" : " "} ${r.ticket.padEnd(11)} ${r.category.padEnd(13)} ${r.text}`);
      }
      if (!rows.length) lines.push("  nothing logged");
      return { ok: true, data: { from, to, author: author ?? null, total, entries: rows }, text: lines.join("\n") };
    },
  });
  return [logWork, show];
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
