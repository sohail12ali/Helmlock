// Read models for the console, built from the mounted services on each request (no cache, no writes).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActivityLine,
  ArtifactContent,
  Board,
  Context,
  NeedsYouItem,
  Overview,
  RecordKindName,
  RunSummary,
  StageDef,
  Ticket,
  TicketCard,
  TicketDetail,
  TicketFilter,
  TicketRecord,
  WorkLogLine,
  WorkspaceSummary,
} from "@helmlock/core";
import { artifactIndex, MAX_ARTIFACT_BYTES, resolveArtifactFile } from "./artifacts.ts";
import { ApiError } from "./errors.ts";

type StoredRecord = TicketRecord & { kind: RecordKindName; path: string };

/** A claim older than this on an open ticket shows up in needs-you. */
export const STALE_CLAIM_DAYS = 7;

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Monday of the week holding `date` (YYYY-MM-DD, local). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

const recordTitle = (r: StoredRecord): string => {
  const x = r as Record<string, unknown>;
  return String(x.title ?? x.text ?? r.id);
};

export function createReadModel(ctx: Context, helmlockVersion: string) {
  const svc = <K extends Parameters<Context["get"]>[0]>(k: K) => ctx.get(k);
  const info = () => svc("workspace");

  async function card(t: Ticket, recs?: StoredRecord[]): Promise<TicketCard> {
    const id = t.ticket.id;
    const [records, tasks] = await Promise.all([recs ?? svc("records").list(id), svc("tasks").list(id)]);
    const c: TicketCard = {
      id,
      title: t.ticket.title,
      stage: t.ticket.stage,
      priority: t.ticket.priority,
      blocked: t.flags.blocked,
      open_questions: records.filter((r) => r.kind === "question" && r.status === "open").length,
      open_bugs: records.filter((r) => r.kind === "bug" && r.status === "open").length,
      tasks: { total: tasks.length, done: tasks.filter((k) => k.status === "done").length },
      updated: t.ticket.updated,
    };
    if (t.ticket.size) c.size = t.ticket.size;
    if (t.ticket.owner) c.owner = t.ticket.owner;
    if (t.ticket.project) c.project = t.ticket.project;
    if (t.flags.blocked_by) c.blocked_by = t.flags.blocked_by;
    if (t.claim?.claimed_by) c.claimed_by = t.claim.claimed_by;
    return c;
  }

  async function cards(filter?: TicketFilter): Promise<TicketCard[]> {
    const list = await svc("tickets").list(filter);
    const out = await Promise.all(list.map((t) => card(t)));
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  function stageCounts(list: { stage: string }[]): (StageDef & { count: number })[] {
    return svc("workflow")
      .stages()
      .map((s) => ({ ...s, count: list.filter((t) => t.stage === s.id).length }));
  }

  async function readRuns(): Promise<RunSummary[]> {
    const files = svc("files");
    const out: RunSummary[] = [];
    for (const p of await files.list("runs/*.json")) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(await files.readText(p)) as Record<string, unknown>;
      } catch {
        continue; // a run being written or a broken file
      }
      const str = (k: string) => (typeof raw[k] === "string" && raw[k] !== "" ? (raw[k] as string) : undefined);
      const r: RunSummary = {
        id: str("id") ?? (p.split("/").pop() as string).replace(/\.json$/, ""),
        runtime: str("runtime") ?? "unknown",
        mode: str("mode") ?? "unknown",
        started: str("started") ?? "",
      };
      for (const k of ["ticket", "agent", "ended", "failure_class", "first_result_line"] as const) {
        const v = str(k);
        if (v !== undefined) r[k] = v;
      }
      if (typeof raw.ok === "boolean") r.ok = raw.ok;
      const u = raw.usage as Record<string, unknown> | undefined;
      if (u && typeof u === "object") {
        r.usage = {
          input_tokens: Number(u.input_tokens ?? 0),
          output_tokens: Number(u.output_tokens ?? 0),
          cost_usd: typeof u.cost_usd === "number" ? u.cost_usd : null,
        };
      }
      out.push(r);
    }
    return out.sort((a, b) => b.started.localeCompare(a.started));
  }

  async function worklog(from: string, to: string, author?: string): Promise<WorkLogLine[]> {
    const rows = await svc("worklog").range(from, to, author);
    return rows.map((e) => ({ date: e.date, author: e.author, ticket: e.ticket, category: e.category, text: e.text, hours_alloc: e.hours_alloc }));
  }

  async function activity(date: string, author?: string): Promise<ActivityLine[]> {
    return svc("activity").read(date, author);
  }

  return {
    async workspace(): Promise<WorkspaceSummary> {
      const i = info();
      const ws = svc("config").workspace;
      const person = i.author ? await svc("roster").get(i.author) : undefined;
      return {
        name: i.name,
        console_name: ws.workspace.console_name ?? `${i.name} Console`,
        author: person ? { id: person.id, name: person.name, initials: person.initials } : null,
        root: i.root,
        delivery: i.deliveryRoot,
        folders: i.folders,
        version: { api: 1, helmlock: helmlockVersion },
      };
    },

    async board(): Promise<Board> {
      const tickets = await cards();
      return { stages: stageCounts(tickets), tickets };
    },

    tickets: (filter: TicketFilter) => cards(filter),

    async ticket(id: string): Promise<TicketDetail> {
      const t = await svc("tickets").get(id);
      const [records, tasks, comments, digest] = await Promise.all([
        svc("records").list(id),
        svc("tasks").list(id),
        svc("tickets").comments(id),
        svc("context").ticket(id),
      ]);
      const titles = new Map(records.map((r) => [r.id, recordTitle(r)]));
      const artifacts = await artifactIndex(info().root, t.dir, titles);
      const { dir: _dir, ...ticket } = t;
      const detail: TicketDetail = { card: await card(t, records), ticket, digest, records, tasks, comments, artifacts };
      const stages = svc("workflow").stages();
      const at = stages.findIndex((s) => s.id === t.ticket.stage);
      const next = at >= 0 && !stages[at]?.terminal ? stages[at + 1] : undefined;
      if (next) detail.next_gate = { to: next.id, gate: await svc("workflow").check(t, next.id) };
      return detail;
    },

    async artifact(ticketId: string, artifactId: string): Promise<ArtifactContent> {
      const t = await svc("tickets").get(ticketId);
      const root = info().root;
      const abs = await resolveArtifactFile(root, t.dir, artifactId);
      const records = await svc("records").list(ticketId);
      const index = await artifactIndex(root, t.dir, new Map(records.map((r) => [r.id, recordTitle(r)])));
      const ref = index.find((r) => r.id === artifactId);
      if (!ref) throw new ApiError(404, "unknown-artifact", `no artifact ${artifactId} in ${ticketId}`, { fix: `GET /api/v1/tickets/${ticketId}` });
      if (ref.size > MAX_ARTIFACT_BYTES)
        throw new ApiError(413, "too-large", `${ref.path} is ${ref.size} bytes; the console shows files up to 2 MB`, {
          file: ref.path,
          fix: "open it in the editor",
        });
      return { ref, text: await readFile(abs, "utf8") };
    },

    async overview(today = localDate()): Promise<Overview> {
      const list = await svc("tickets").list();
      const stages = svc("workflow").stages();
      const terminal = new Set(stages.filter((s) => s.terminal).map((s) => s.id));
      const first = stages[0]?.id;
      const needs: NeedsYouItem[] = [];

      // Setup issues first: without an author no verb can write.
      const i = info();
      if (!i.author) needs.push({ kind: "setup", title: "No author set on this machine", detail: "write your roster id to author.local (see `hl doctor`)" });
      else if (!(await svc("roster").get(i.author)))
        needs.push({ kind: "setup", title: `Author ${i.author} is not in the roster`, detail: "add yourself to people.toml (see `hl doctor`)" });

      const now = Date.parse(`${today}T23:59:59`);
      for (const t of [...list].sort((a, b) => a.ticket.id.localeCompare(b.ticket.id))) {
        const id = t.ticket.id;
        if (t.flags.blocked)
          needs.push({
            kind: "blocked",
            ticket: id,
            id,
            title: `${id} blocked${t.flags.blocked_by ? `: ${t.flags.blocked_by}` : ""}`,
            ...(t.flags.next_action ? { detail: t.flags.next_action } : {}),
          });
        if (terminal.has(t.ticket.stage)) continue;
        for (const q of await svc("records").list(id, "question")) {
          if (q.status !== "open" || !("blocking" in q) || !q.blocking) continue;
          needs.push({ kind: "question", ticket: id, id: q.id, title: `Answer ${q.id}: ${recordTitle(q)}`, detail: `blocks ${id}` });
        }
        const claimedAt = t.claim ? Date.parse(t.claim.claimed_at) : Number.NaN;
        if (t.claim && now - claimedAt > STALE_CLAIM_DAYS * 86_400_000)
          needs.push({ kind: "claim-stale", ticket: id, id, title: `${id} claimed by ${t.claim.claimed_by} since ${t.claim.claimed_at.slice(0, 10)}` });
      }

      const runs = await readRuns();
      for (const r of runs)
        if (r.ok === false)
          needs.push({
            kind: "run-failed",
            id: r.id,
            ...(r.ticket ? { ticket: r.ticket } : {}),
            title: `Run ${r.id} failed${r.agent ? ` (${r.agent})` : ""}`,
            ...(r.failure_class || r.first_result_line ? { detail: [r.failure_class, r.first_result_line].filter(Boolean).join(": ") } : {}),
          });

      const monday = weekStart(today);
      const weekEnd = addDays(monday, 7);
      const done_this_week = list.filter((t) => {
        if (!terminal.has(t.ticket.stage)) return false;
        const d = localDate(new Date(t.ticket.updated));
        return d >= monday && d < weekEnd;
      }).length;

      const [wl, act] = await Promise.all([worklog(today, today), activity(today)]);
      return {
        needs_you: needs,
        stages: stageCounts(list.map((t) => ({ stage: t.ticket.stage }))),
        in_progress: list.filter((t) => t.ticket.stage !== first && !terminal.has(t.ticket.stage)).length,
        done_this_week,
        today: { date: today, worklog: wl, activity: act },
        runs: runs.slice(0, 10),
      };
    },

    activity,
    worklog,
    runs: readRuns,
    skills: () => svc("skills").list(),
    search: (q: string) => svc("search").query(q, { limit: 100 }),
  };
}

export type ReadModel = ReturnType<typeof createReadModel>;

/** Version of the delivery repo for the footer: root package.json `version`, else "0.0.0-dev". */
export async function helmlockVersion(deliveryRoot: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(deliveryRoot, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}
