import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type {
  PluginCatalog,
  PluginModule,
  RecordKindName,
  RecordsService,
  SessionDigest,
  Task,
  TasksService,
  Ticket,
  TicketDigest,
  TicketRecord,
  TicketsService,
} from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { SESSION_CHARS, SESSION_ROWS, sessionText } from "./index.ts";

const NOW = "2026-10-07T09:00:00Z";
const ticket = (n: number, stage: string, extra: Partial<Ticket["ticket"]> = {}, blocked = false): Ticket => {
  const id = `T-${String(n).padStart(3, "0")}-sa`;
  return {
    schema_version: 1,
    ticket: { id, title: `Ticket number ${n} with a reasonably long title for the digest`, stage, priority: "normal", created: NOW, updated: NOW, ...extra },
    flags: blocked ? { blocked: true, blocked_by: "ops", next_action: "get the UAT login" } : { blocked: false },
    links: { related: [] },
    changes: [],
    dir: `artifacts/${id}`,
  };
};

type Rec = TicketRecord & { kind: RecordKindName; path: string };
const q = (id: string, t: string, text: string, blocking: boolean, status = "open"): Rec =>
  ({ schema_version: 1, id, ticket: t, text, blocking, options: [], status, asked: NOW, author: "sam", kind: "question", path: "" }) as unknown as Rec;
const bug = (id: string, t: string, title: string, status = "open"): Rec =>
  ({ schema_version: 1, id, ticket: t, title, severity: "medium", status, date: NOW, author: "sam", kind: "bug", path: "" }) as unknown as Rec;
const task = (id: string, status: Task["status"], depends: string[] = []): Task => ({
  id,
  slice: id.split("-")[0] as string,
  title: `task ${id}`,
  layer: "api",
  acs: [],
  status,
  depends,
  files: [],
});

/** A stand-in for S3's tickets-toml: canned tickets, records and tasks. */
function fakeTicketsPlugin(tickets: Ticket[], records: Rec[], tasks: Record<string, Task[]>): PluginModule {
  const nope = () => {
    throw new Error("not in the fake");
  };
  const ticketsSvc: TicketsService = {
    nextId: nope,
    create: nope,
    async get(id) {
      const t = tickets.find((x) => x.ticket.id === id);
      if (!t) throw Object.assign(new Error(`no ticket ${id}`), { rule: "not-found" });
      return t;
    },
    async list() {
      return tickets;
    },
    move: nope,
    setBlocked: nope,
    claim: nope,
    release: nope,
    comment: nope,
    comments: nope,
  };
  const recordsSvc: RecordsService = {
    add: nope,
    async list(t, kind) {
      return records.filter((r) => r.ticket === t && (!kind || r.kind === kind));
    },
    get: nope,
    update: nope,
    async blockers(t) {
      return records.filter((r) => r.ticket === t && r.status === "open" && (r.kind !== "question" || (r as { blocking?: boolean }).blocking));
    },
  };
  const tasksSvc: TasksService = {
    async list(t) {
      return tasks[t] ?? [];
    },
    add: nope,
    set: nope,
  };
  return {
    name: "tickets-toml",
    apply(ctx) {
      ctx.provide("tickets", ticketsSvc);
      ctx.provide("records", recordsSvc);
      ctx.provide("tasks", tasksSvc);
    },
  };
}

const withFake = (mod: PluginModule): PluginCatalog => ({
  ...catalog,
  "tickets-toml": { dir: (catalog["tickets-toml"] as { dir: string }).dir, load: async () => ({ default: mod }) },
});

test("ticket digest matches the TicketDigest contract", async () => {
  const t = ticket(14, "plan", { size: "M", owner: "sam", project: "wms", goal: "G-001-sa" });
  t.claim = { claimed_by: "sam", claimed_at: NOW };
  const records = [
    q("Q-001-sa", "T-014-sa", "Which carrier codes apply?", false),
    q("Q-002-sa", "T-014-sa", "Is UAT frozen this week?", true),
    q("Q-003-sa", "T-014-sa", "Old answered question", true, "answered"),
    bug("B-001-sa", "T-014-sa", "Totals off by one"),
    bug("B-002-sa", "T-014-sa", "Fixed already", "fixed"),
  ];
  const tasks = { "T-014-sa": [task("S1-T1", "done"), task("S1-T2", "todo", ["S1-T1"]), task("S1-T3", "todo", ["S1-T2"])] };
  const ws = await createTestWorkspace({ catalog: withFake(fakeTicketsPlugin([t], records, tasks)) });
  try {
    mkdirSync(join(ws.root, "artifacts/T-014-sa/notes"), { recursive: true });
    writeFileSync(join(ws.root, "artifacts/T-014-sa/ticket.toml"), "");
    writeFileSync(join(ws.root, "artifacts/T-014-sa/T-014-sa-spec.md"), "# spec\n");
    writeFileSync(join(ws.root, "artifacts/T-014-sa/notes/call.md"), "notes\n");

    const res = await ws.run("context", { ticket: "T-014-sa" });
    assert.ok(res.ok, JSON.stringify(res));
    const d = res.data as TicketDigest;
    assert.deepEqual(Object.keys(d).sort(), ["blocked", "claim", "files", "next", "open_bugs", "open_questions", "tasks", "ticket"]);
    assert.deepEqual(d.ticket, {
      id: "T-014-sa",
      title: t.ticket.title,
      stage: "plan",
      size: "M",
      priority: "normal",
      owner: "sam",
      project: "wms",
      goal: "G-001-sa",
    });
    assert.deepEqual(d.blocked, { blocked: false });
    assert.deepEqual(d.claim, { by: "sam", at: NOW });
    assert.deepEqual(d.open_questions, [
      { id: "Q-001-sa", text: "Which carrier codes apply?", blocking: false },
      { id: "Q-002-sa", text: "Is UAT frozen this week?", blocking: true },
    ]);
    assert.deepEqual(d.open_bugs, [{ id: "B-001-sa", title: "Totals off by one" }]);
    assert.deepEqual(d.tasks, { total: 3, done: 1, next: "S1-T2 task S1-T2" });
    assert.ok(d.next.includes("answer Q-002-sa"));
    assert.ok(d.next.includes("fix B-001-sa"));
    assert.ok(d.next.some((n) => n.startsWith("start S1-T2")));
    assert.ok(!d.next.some((n) => n.startsWith("move to")), "blocked by an open question, so no move suggestion");
    assert.deepEqual(d.files, ["T-014-sa-spec.md", "notes/call.md", "ticket.toml"]);
    assert.match(res.text ?? "", /T-014-sa/);

    const both = await ws.run("context", { ticket: "T-014-sa", session: true });
    assert.equal(both.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("a clear ticket suggests the next stage; a blocked one says what unblocks it", async () => {
  const clear = ticket(1, "spec");
  const stuck = ticket(2, "build", {}, true);
  const ws = await createTestWorkspace({ catalog: withFake(fakeTicketsPlugin([clear, stuck], [], {})) });
  try {
    await ws.runtime.mountForVerb("context");
    const a = await ws.runtime.ctx.get("context").ticket("T-001-sa");
    assert.ok(a.next.includes("move to plan"));
    assert.ok(a.next.includes("claim T-001-sa"));
    const b = await ws.runtime.ctx.get("context").ticket("T-002-sa");
    assert.deepEqual(b.blocked, { blocked: true, by: "ops", next: "get the UAT login" });
    assert.equal(b.next[0], "unblock: get the UAT login");
    assert.deepEqual(b.files, []);
  } finally {
    await ws.cleanup();
  }
});

test("session digest lists in-flight work, skills by layer and waiting questions, capped", async () => {
  const tickets: Ticket[] = [ticket(1, "backlog"), ticket(2, "done")];
  for (let n = 3; n < 30; n++) tickets.push(ticket(n, ["spec", "plan", "build", "verify"][n % 4] as string, {}, n === 7));
  const records = [q("Q-001-sa", "T-005-sa", "Which carrier codes apply?", true), q("Q-002-sa", "T-005-sa", "Non-blocking", false)];
  const ws = await createTestWorkspace({ catalog: withFake(fakeTicketsPlugin(tickets, records, {})) });
  try {
    mkdirSync(join(ws.root, ".claude/skills/glossary"), { recursive: true });
    writeFileSync(join(ws.root, ".claude/skills/glossary/SKILL.md"), "---\nname: glossary\ndescription: Client terms.\n---\n");
    const res = await ws.run("context", { session: true });
    assert.ok(res.ok, JSON.stringify(res));
    const d = res.data as SessionDigest;
    assert.deepEqual(Object.keys(d).sort(), ["in_flight", "skills", "waiting"]);
    assert.equal(d.in_flight.length, SESSION_ROWS);
    assert.ok(d.in_flight.every((t) => t.stage !== "backlog" && t.stage !== "done"));
    assert.equal(d.in_flight[0]?.id, "T-007-sa", "blocked tickets come first");
    assert.deepEqual(Object.keys(d.skills).sort(), ["local", "personal", "project", "system", "workspace"]);
    assert.deepEqual(d.skills.workspace, ["glossary"]);
    assert.deepEqual(d.waiting, ["Q-001-sa (T-005-sa): Which carrier codes apply?"]);
    const text = res.text ?? "";
    assert.ok(text.length <= SESSION_CHARS, `session text is ${text.length} characters`);
    assert.ok(text.split("\n").length <= SESSION_ROWS + 6);
    assert.match(text, /In flight/);
    assert.match(text, /Skills: system/);

    const many: SessionDigest = { ...d, in_flight: d.in_flight.map((t) => ({ ...t, title: t.title.repeat(5) })) };
    assert.ok(sessionText(many).length <= SESSION_CHARS);
  } finally {
    await ws.cleanup();
  }
});
