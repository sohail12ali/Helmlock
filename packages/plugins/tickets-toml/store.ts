// tickets, records and tasks over plain files (Blueprint 16):
//   artifacts/<T>/ticket.toml, tasks.toml, comments.jsonl, decisions|questions|bugs|gaps/<id>.toml
// Every write is read-modify-write with expectHash, and honours dryRun (nothing touches disk).
import {
  type Actor,
  CommentLine,
  type Context,
  type CreateTicketInput,
  type FileLayer,
  type GateResult,
  type Person,
  RecordId,
  type RecordKindName,
  type Task,
  type TasksToml,
  type Ticket,
  type TicketFilter,
  TicketId,
  type TicketRecord,
  type TicketToml,
  type WriteResult,
} from "@helmlock/core";
import { KIND_BY_PREFIX, RECORD_FOLDERS, RECORD_PREFIX } from "./emitters.ts";
import { clean, HlError } from "./errors.ts";

export const ARTIFACTS = "artifacts";
export const ticketDir = (id: string) => `${ARTIFACTS}/${id}`;
export const ticketFile = (id: string) => `${ticketDir(id)}/ticket.toml`;
export const tasksFile = (id: string) => `${ticketDir(id)}/tasks.toml`;
export const commentsFile = (id: string) => `${ticketDir(id)}/comments.jsonl`;
export const recordFile = (kind: RecordKindName, ticket: string, id: string) => `${ticketDir(ticket)}/${RECORD_FOLDERS[kind]}/${id}.toml`;

export type Prefix = "T" | "D" | "Q" | "B" | "G" | "TD";
type StoredRecord = TicketRecord & { kind: RecordKindName; path: string };

/** What a write did (or would do, in a dry run). Verbs show it; services return only the entity. */
export interface Outcome<T> {
  value: T;
  writes: WriteResult[];
}

const now = () => new Date().toISOString();
const pad = (n: number) => String(n).padStart(3, "0");

export function createStore(ctx: Context) {
  const files = (): FileLayer => ctx.get("files");

  async function person(actor: Actor): Promise<Person> {
    const roster = ctx.get("roster");
    return (await roster.get(actor.onBehalfOf)) ?? (await roster.current());
  }

  // ---------- ids ----------
  /** Counter per prefix across all authors' ids (so ids stay unique in the workspace), suffixed with these initials. */
  async function nextId(prefix: Prefix, initials: string): Promise<string> {
    const f = files();
    let globs: string[];
    // Archived tickets (archive/YYYY-MM/<T>) keep their ids: never issue one again.
    if (prefix === "T") globs = [`${ARTIFACTS}/T-*`, "archive/*/T-*"];
    else if (prefix === "TD") globs = ["todos/TD-*", "todos/*/TD-*", "people/*/todos/TD-*", ".hl-local/todos/TD-*"];
    else {
      const folder = RECORD_FOLDERS[KIND_BY_PREFIX[prefix]!];
      globs = [`${ARTIFACTS}/*/${folder}/${prefix}-*.toml`, `archive/*/*/${folder}/${prefix}-*.toml`];
    }
    const re = new RegExp(`^${prefix}-(\\d+)-[a-z]{2,3}(\\.toml)?$`);
    let max = 0;
    for (const g of globs) {
      for (const p of await f.list(g)) {
        const m = re.exec(p.split("/").pop() ?? "");
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return `${prefix}-${pad(max + 1)}-${initials}`;
  }

  // ---------- tickets ----------
  async function readTicket(id: string): Promise<{ data: TicketToml; hash: string }> {
    if (!TicketId.safeParse(id).success) throw new HlError("bad-id", `not a ticket id: ${id}`, { fix: "ticket ids look like T-014-sa" });
    const f = files();
    if (!(await f.exists(ticketFile(id)))) throw new HlError("unknown-ticket", `no ticket ${id}`, { fix: "hl ticket list" });
    return f.readToml<TicketToml>(ticketFile(id), "ticket");
  }
  const toTicket = (t: TicketToml): Ticket => ({ ...t, dir: ticketDir(t.ticket.id) });

  async function writeTicket(t: TicketToml, expectHash: string | undefined, dryRun: boolean): Promise<WriteResult> {
    const data = clean({ ...t, ticket: { ...t.ticket, updated: now() } });
    return files().writeToml(ticketFile(t.ticket.id), "ticket", data, { expectHash, dryRun });
  }

  async function create(input: CreateTicketInput, actor: Actor, dryRun: boolean): Promise<Outcome<Ticket>> {
    const me = await person(actor);
    const id = await nextId("T", me.initials);
    const stages = ctx.get("workflow").stages();
    const first = stages[0];
    if (!first) throw new HlError("no-stages", "the workflow has no stages");
    const ts = now();
    const t: TicketToml = {
      schema_version: 1,
      ticket: {
        id,
        title: input.title,
        summary: input.summary,
        stage: first.id,
        size: input.size,
        priority: input.priority ?? "normal",
        owner: me.id,
        project: input.project,
        goal: input.goal,
        created: ts,
        updated: ts,
      },
      flags: { blocked: false },
      links: { related: [] },
      changes: [],
    };
    if (await files().exists(ticketFile(id))) throw new HlError("id-taken", `${id} already exists; run again`);
    const w = await files().writeToml(ticketFile(id), "ticket", clean(t), { dryRun });
    if (!dryRun) await ctx.emit("ticket.created", { id, title: input.title, actor });
    return { value: toTicket(t), writes: [w] };
  }

  async function list(filter: TicketFilter = {}): Promise<Ticket[]> {
    const out: Ticket[] = [];
    for (const p of await files().list(`${ARTIFACTS}/*/ticket.toml`)) {
      let t: TicketToml;
      try {
        t = (await files().readToml<TicketToml>(p, "ticket")).data;
      } catch {
        continue; // `hl validate` reports broken tickets
      }
      if (filter.stage && t.ticket.stage !== filter.stage) continue;
      if (filter.project && t.ticket.project !== filter.project) continue;
      if (filter.owner && t.ticket.owner !== filter.owner && t.claim?.claimed_by !== filter.owner) continue;
      if (filter.blocked !== undefined && t.flags.blocked !== filter.blocked) continue;
      out.push(toTicket(t));
    }
    return out;
  }

  async function move(id: string, to: string, actor: Actor, dryRun: boolean): Promise<Outcome<{ ticket: Ticket; gate: GateResult }>> {
    const { data, hash } = await readTicket(id);
    const from = data.ticket.stage;
    const ticket = toTicket(data);
    const gate = await ctx.get("workflow").check(ticket, to);
    if (gate.allowed) {
      const denied = await ctx.checkGuards("ticket/pre-move", { id, from, to, actor });
      for (const message of denied) gate.reasons.push({ rule: "guard:ticket/pre-move", message });
      if (denied.length) gate.allowed = false;
    }
    if (!gate.allowed || from === to) return { value: { ticket, gate }, writes: [] };
    const next: TicketToml = { ...data, ticket: { ...data.ticket, stage: to } };
    const w = await writeTicket(next, hash, dryRun);
    if (!dryRun) await ctx.emit("ticket.moved", { id, from, to, actor });
    return { value: { ticket: toTicket(next), gate }, writes: [w] };
  }

  async function setFields(
    id: string,
    patch: Partial<Pick<TicketToml["ticket"], "size" | "priority" | "title" | "summary" | "project" | "goal">>,
    _actor: Actor,
    dryRun: boolean,
  ): Promise<Outcome<Ticket>> {
    const { data, hash } = await readTicket(id);
    const next: TicketToml = { ...data, ticket: { ...data.ticket, ...clean(patch) } };
    const w = await writeTicket(next, hash, dryRun);
    return { value: toTicket(next), writes: [w] };
  }

  async function setBlocked(id: string, b: { by: string; next: string } | null, actor: Actor, dryRun: boolean): Promise<Outcome<Ticket>> {
    if (b && (!b.by?.trim() || !b.next?.trim())) {
      throw new HlError("blocked-needs-by-and-next", "blocking a ticket needs --by and --next", {
        fix: `hl ticket block ${id} --by "<who>" --next "<action>"`,
      });
    }
    const { data, hash } = await readTicket(id);
    const flags = b
      ? { ...data.flags, blocked: true, blocked_by: b.by, next_action: b.next }
      : { ...data.flags, blocked: false, blocked_by: undefined, next_action: undefined };
    const next: TicketToml = { ...data, flags };
    const w = await writeTicket(next, hash, dryRun);
    if (!dryRun) await ctx.emit("ticket.blocked", { id, blocked: !!b, by: b?.by, next: b?.next, actor });
    return { value: toTicket(next), writes: [w] };
  }

  /** Compare-and-set claim (paperclip checkout): a claim held by someone else is a conflict, never retried. */
  async function claim(id: string, actor: Actor, dryRun: boolean): Promise<Outcome<Ticket>> {
    const me = await person(actor);
    const { data, hash } = await readTicket(id);
    const held = data.claim;
    if (held && held.claimed_by !== me.id) throw conflict(id, held.claimed_by, held.claimed_at);
    if (held) return { value: toTicket(data), writes: [] };
    const next: TicketToml = { ...data, claim: { claimed_by: me.id, claimed_at: now() } };
    try {
      const w = await writeTicket(next, hash, dryRun);
      return { value: toTicket(next), writes: [w] };
    } catch (e) {
      if ((e as { rule?: string }).rule !== "stale-write") throw e;
      const fresh = (await readTicket(id)).data.claim;
      throw conflict(id, fresh?.claimed_by ?? "someone else", fresh?.claimed_at ?? "just now");
    }
  }
  const conflict = (id: string, by: string, at: string) =>
    new HlError("claim-conflict", `${id} is claimed by ${by} since ${at}. Do not retry: pick another ticket or ask ${by} to release it.`, {
      file: ticketFile(id),
    });

  async function release(id: string, actor: Actor, dryRun: boolean): Promise<Outcome<Ticket>> {
    const me = await person(actor);
    const { data, hash } = await readTicket(id);
    if (!data.claim) return { value: toTicket(data), writes: [] };
    if (data.claim.claimed_by !== me.id) {
      throw new HlError("not-claimant", `${id} is claimed by ${data.claim.claimed_by}, not ${me.id}; only they can release it`);
    }
    const next: TicketToml = { ...data, claim: undefined };
    const w = await writeTicket(next, hash, dryRun);
    return { value: toTicket(next), writes: [w] };
  }

  async function comment(id: string, text: string, actor: Actor, dryRun: boolean): Promise<Outcome<CommentLine>> {
    await readTicket(id);
    if (!text.trim()) throw new HlError("empty-comment", "a comment needs text");
    const me = await person(actor);
    const line: CommentLine = { ts: now(), author: me.id, text };
    await files().appendJsonl(commentsFile(id), line, { dryRun });
    return { value: line, writes: [{ path: commentsFile(id), hash: "", changed: true, text: `${JSON.stringify(line)}\n` }] };
  }

  const comments = async (id: string) => {
    await readTicket(id);
    return files().readJsonl(commentsFile(id), CommentLine);
  };

  // ---------- records ----------
  async function addRecord(kind: RecordKindName, ticket: string, data: Record<string, unknown>, actor: Actor, dryRun: boolean): Promise<Outcome<TicketRecord>> {
    await readTicket(ticket);
    const me = await person(actor);
    const id = await nextId(RECORD_PREFIX[kind], me.initials);
    const ts = now();
    const stamp = kind === "question" ? { asked: ts } : { date: ts };
    const rec = clean({ schema_version: 1, id, ticket, ...data, ...stamp, author: me.id }) as TicketRecord;
    const rel = recordFile(kind, ticket, id);
    if (await files().exists(rel)) throw new HlError("id-taken", `${id} already exists; run again`);
    const w = await files().writeToml(rel, kind, rec, { dryRun });
    if (!dryRun) await ctx.emit("record.added", { kind, id, ticket, actor });
    return { value: rec, writes: [w] };
  }

  async function listRecords(ticket: string, kind?: RecordKindName): Promise<StoredRecord[]> {
    const kinds = kind ? [kind] : (Object.keys(RECORD_FOLDERS) as RecordKindName[]);
    const out: StoredRecord[] = [];
    for (const k of kinds) {
      for (const p of await files().list(`${ticketDir(ticket)}/${RECORD_FOLDERS[k]}/*.toml`)) {
        try {
          out.push({ ...(await files().readToml<TicketRecord>(p, k)).data, kind: k, path: p });
        } catch {
          // unparsable record: `hl validate` reports it
        }
      }
    }
    return out;
  }

  async function findRecord(id: string): Promise<{ kind: RecordKindName; path: string; data: TicketRecord; hash: string }> {
    if (!RecordId.safeParse(id).success) throw new HlError("bad-id", `not a record id: ${id}`, { fix: "record ids look like Q-003-sa" });
    const kind = KIND_BY_PREFIX[id[0]!]!;
    const [path] = await files().list(`${ARTIFACTS}/*/${RECORD_FOLDERS[kind]}/${id}.toml`);
    if (!path) throw new HlError("unknown-record", `no ${kind} ${id}`);
    const r = await files().readToml<TicketRecord>(path, kind);
    return { kind, path, ...r };
  }

  async function updateRecord(id: string, patch: Record<string, unknown>, _actor: Actor, dryRun: boolean): Promise<Outcome<TicketRecord>> {
    const r = await findRecord(id);
    const next = clean({ ...r.data, ...clean(patch), id: r.data.id, ticket: r.data.ticket }) as TicketRecord;
    const w = await files().writeToml(r.path, r.kind, next, { expectHash: r.hash, dryRun });
    return { value: next, writes: [w] };
  }

  async function blockers(ticket: string): Promise<(TicketRecord & { kind: RecordKindName })[]> {
    await readTicket(ticket);
    return (await listRecords(ticket)).filter(
      (r) => r.status === "open" && (r.kind === "bug" || r.kind === "gap" || (r.kind === "question" && "blocking" in r && r.blocking)),
    );
  }

  // ---------- tasks ----------
  async function readTasks(ticket: string): Promise<{ data: TasksToml; hash: string | undefined }> {
    await readTicket(ticket);
    const f = files();
    if (!(await f.exists(tasksFile(ticket)))) return { data: { schema_version: 1, ticket, task: [] }, hash: undefined };
    return f.readToml<TasksToml>(tasksFile(ticket), "tasks");
  }

  async function addTask(
    ticket: string,
    task: Omit<Task, "id" | "status" | "depends" | "files" | "acs"> & Partial<Task>,
    _actor: Actor,
    dryRun: boolean,
  ): Promise<Outcome<Task>> {
    const { data, hash } = await readTasks(ticket);
    const slice = task.slice || "S1";
    if (!/^S\d+$/.test(slice)) throw new HlError("bad-slice", `slice must look like S1, got ${slice}`);
    const n = Math.max(0, ...data.task.filter((t) => t.slice === slice).map((t) => Number(t.id.split("-T")[1]) || 0)) + 1;
    const known = new Set(data.task.map((x) => x.id));
    for (const d of task.depends ?? [])
      if (!known.has(d)) throw new HlError("unknown-task", `--depends ${d}: ${ticket} has no such task`, { fix: `hl task list ${ticket}` });
    const t: Task = clean({ status: "todo", depends: [], files: [], acs: [], ...task, slice, id: `${slice}-T${n}` }) as Task;
    const w = await files().writeToml(tasksFile(ticket), "tasks", clean({ ...data, task: [...data.task, t] }), { expectHash: hash, dryRun });
    return { value: t, writes: [w] };
  }

  async function setTask(ticket: string, taskId: string, patch: Partial<Task>, _actor: Actor, dryRun: boolean): Promise<Outcome<Task>> {
    const { data, hash } = await readTasks(ticket);
    const i = data.task.findIndex((t) => t.id === taskId);
    if (i < 0) throw new HlError("unknown-task", `${ticket} has no task ${taskId}`, { fix: `hl ticket show ${ticket}` });
    const t = clean({ ...data.task[i]!, ...clean(patch), id: taskId }) as Task;
    const all = data.task.map((x, j) => (j === i ? t : x));
    const w = await files().writeToml(tasksFile(ticket), "tasks", clean({ ...data, task: all }), { expectHash: hash, dryRun });
    return { value: t, writes: [w] };
  }

  return {
    person,
    nextId,
    readTicket,
    create,
    get: async (id: string) => toTicket((await readTicket(id)).data),
    list,
    move,
    setFields,
    setBlocked,
    claim,
    release,
    comment,
    comments,
    addRecord,
    listRecords,
    getRecord: async (id: string): Promise<StoredRecord> => {
      const r = await findRecord(id);
      return { ...r.data, kind: r.kind, path: r.path };
    },
    updateRecord,
    blockers,
    listTasks: async (ticket: string) => (await readTasks(ticket)).data.task,
    addTask,
    setTask,
  };
}

export type Store = ReturnType<typeof createStore>;
