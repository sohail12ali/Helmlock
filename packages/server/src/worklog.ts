// Work page reads (the work log rebuild): day sheets with allocation, range rollups, search, the quick-add config,
// day-length evidence and suggested entries. Allocation runs in the work-log plugin, the same code as `hl log show`.
// Writes stay verbs: log-work, log edit, log remove, log day-hours.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ActivityLine,
  ApiResponse,
  Runtime,
  WorkConfigView,
  WorkDayView,
  WorkEvidence,
  WorkRangeView,
  WorkSearchResult,
  WorkSuggestions,
} from "@helmlock/core";
import { liveFolders } from "@helmlock/plugins/crew/project-dir.ts";
import { evidenceFor, localStamp, type RunWindow, scanGit } from "@helmlock/plugins/work-log/evidence.ts";
import type { WorkLogFull } from "@helmlock/plugins/work-log/index.ts";
import { type RunLike, suggestionsFor } from "@helmlock/plugins/work-log/suggest.ts";
import { rangeOf } from "@helmlock/plugins/work-log/views.ts";
import type { Hono, Context as HonoContext } from "hono";
import { localDate, type ReadModel } from "./data.ts";
import { ApiError } from "./errors.ts";
import { failJson } from "./models.ts";

export interface WorklogDeps {
  runtime: Runtime;
  ready: () => Promise<ReadModel>;
  log: (line: string) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 370;

function dateQ(c: HonoContext, name: string, fallback?: string): string {
  const v = c.req.query(name);
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, "bad-request", `${name} is required (YYYY-MM-DD)`);
  }
  if (!DATE_RE.test(v)) throw new ApiError(400, "bad-request", `${name} must be YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return v;
}

const wl = (runtime: Runtime) => runtime.ctx.get("worklog") as WorkLogFull;

async function names(runtime: Runtime): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of await runtime.ctx.get("roster").list()) out[p.id] = p.name;
  return out;
}

/** Run records (runs/<id>.json) merged with the run manager's view (milestone 8 `outcome`), tolerant of either missing. */
async function runRecords(runtime: Runtime): Promise<RunLike[]> {
  const files = runtime.ctx.get("files");
  const byId = new Map<string, RunLike>();
  for (const p of await files.list("runs/*.json")) {
    try {
      const raw = JSON.parse(await files.readText(p)) as Record<string, unknown>;
      const str = (k: string) => (typeof raw[k] === "string" && raw[k] !== "" ? (raw[k] as string) : undefined);
      const id = str("id") ?? (p.split("/").pop() as string).replace(/\.json$/, "");
      const r: RunLike = { id, started: str("started") ?? "" };
      for (const k of ["ticket", "agent", "role", "ended", "responsible", "first_result_line", "status"] as const) {
        const v = str(k);
        if (v !== undefined) (r as unknown as Record<string, string>)[k] = v;
      }
      if (typeof raw.ok === "boolean") r.ok = raw.ok;
      if (raw.outcome && typeof raw.outcome === "object") r.outcome = raw.outcome as RunLike["outcome"];
      byId.set(id, r);
    } catch {
      // a run being written or a broken file
    }
  }
  if (runtime.ctx.has("runManager")) {
    try {
      const rm = runtime.ctx.get("runManager");
      const states = [...(typeof rm.list === "function" ? await rm.list({ limit: 500 }) : []), ...rm.active()];
      for (const s of states) {
        const prev = byId.get(s.id);
        const merged: RunLike = { ...prev, id: s.id, started: s.started, status: s.status };
        if (s.ended) merged.ended = s.ended;
        if (s.ticket) merged.ticket = s.ticket;
        if (s.role) merged.role = s.role;
        if (s.agent) merged.agent = s.agent;
        if (s.first_result_line) merged.first_result_line = s.first_result_line;
        if (s.outcome && typeof s.outcome === "object") merged.outcome = s.outcome;
        byId.set(s.id, merged);
      }
    } catch {
      // the run manager is optional here
    }
  }
  return [...byId.values()];
}

export function registerWorklogRoutes(api: Hono, d: WorklogDeps): void {
  const { runtime, log } = d;
  const get = (path: string, fn: (c: HonoContext) => Promise<unknown>) =>
    api.get(path, async (c) => {
      try {
        await d.ready();
        return c.json({ ok: true, data: await fn(c) } satisfies ApiResponse<unknown>);
      } catch (e) {
        return failJson(c, e, log);
      }
    });
  const author = (c: HonoContext) => {
    const a = c.req.query("author");
    if (!a) return undefined;
    if (a === "me") return runtime.info.author ?? undefined;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(a)) throw new ApiError(400, "bad-request", `author must be a roster id, got ${JSON.stringify(a)}`);
    return a;
  };

  get("/worklog/config", async (): Promise<WorkConfigView> => {
    const s = wl(runtime).settings();
    const people = await names(runtime);
    const me = runtime.info.author;
    const ids = new Set(await wl(runtime).authors());
    if (me) ids.add(me);
    return {
      ...s,
      me: me ? { id: me, name: people[me] ?? me } : null,
      authors: [...ids].map((id) => ({ id, name: people[id] ?? id })).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name))),
    };
  });

  get("/worklog/day", async (c): Promise<WorkDayView> => {
    const date = dateQ(c, "date", localDate());
    const who = author(c);
    const sheets = await wl(runtime).sheets(date, date, who, await names(runtime));
    return { date, floor: wl(runtime).settings().floor, sheets };
  });

  get("/worklog/range", async (c): Promise<WorkRangeView> => {
    const end = dateQ(c, "end", localDate());
    const start = dateQ(c, "start");
    if (start > end) throw new ApiError(400, "bad-request", `start ${start} is after end ${end}`);
    const days = (new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86_400_000;
    if (days > MAX_RANGE_DAYS) throw new ApiError(400, "bad-request", `a range is at most ${MAX_RANGE_DAYS} days`);
    const who = author(c);
    return rangeOf(await wl(runtime).sheets(start, end, who), start, end, who ?? null);
  });

  get("/worklog/search", async (c): Promise<WorkSearchResult> => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) throw new ApiError(400, "bad-request", "search needs ?q=<terms>");
    const res = await wl(runtime).search(q, author(c), 200);
    return { query: q, ...res };
  });

  get("/worklog/evidence", async (c): Promise<WorkEvidence> => {
    const date = dateQ(c, "date", localDate());
    const who = author(c) ?? runtime.info.author;
    if (!who) throw new ApiError(403, "unknown-author", "no author is set on this machine", { fix: "write your roster id to author.local" });
    const person = await runtime.ctx.get("roster").get(who);
    if (!person) throw new ApiError(404, "unknown-author", `${who} is not in people.toml`);
    const spellings = [...(person.git ?? []), ...(person.email ? [person.email] : [])];
    const info = runtime.info;
    const repos = [{ name: "knowledge", abs: info.root }, ...liveFolders(info)].filter(
      (f, i, all) => existsSync(join(f.abs, ".git")) && all.findIndex((x) => x.abs.toLowerCase() === f.abs.toLowerCase()) === i,
    );
    const commits = scanGit(repos, date, spellings);
    const runs: RunWindow[] = [];
    for (const r of await runRecords(runtime)) {
      if (r.responsible !== who) continue;
      const start = localStamp(r.started);
      if (!start || start.slice(0, 10) !== date) continue;
      const end = r.ended ? localStamp(r.ended) : undefined;
      runs.push({ id: r.id, start, ...(end ? { end } : {}) });
    }
    const sheet = await wl(runtime).sheet(date, who);
    return evidenceFor({
      date,
      author: who,
      commits,
      runs,
      floor: wl(runtime).settings().floor,
      ...(sheet?.day_hours !== undefined ? { declared: sheet.day_hours } : {}),
    });
  });

  get("/worklog/suggestions", async (c): Promise<WorkSuggestions> => {
    const date = dateQ(c, "date", localDate());
    const who = runtime.info.author;
    if (!who) return { date, author: null, items: [] };
    const [runs, activity, day, tickets] = await Promise.all([
      runRecords(runtime),
      runtime.ctx.get("activity").read(date, who) as Promise<ActivityLine[]>,
      wl(runtime).day(date, who),
      runtime.ctx.get("tickets").list(),
    ]);
    const titles: Record<string, string> = {};
    for (const t of tickets) titles[t.ticket.id] = t.ticket.title;
    return { date, author: who, items: suggestionsFor({ date, author: who, runs, activity, entries: day?.entry ?? [], titles }) };
  });
}
