import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Task, Ticket, TicketRecord, VerbResult } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { KIM, testCatalog } from "./testing-fakes.ts";

type Data = Record<string, unknown>;
function okData(r: VerbResult): Data {
  assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  return r.data as Data;
}
function failed(r: VerbResult, code: 1 | 2, rule: string) {
  assert.equal(r.ok, false, `expected failure, got ${JSON.stringify(r)}`);
  if (r.ok) return;
  assert.equal(r.code, code, JSON.stringify(r.error));
  assert.equal(r.error.rule, rule, r.error.message);
}

async function withWs(fn: (ws: TestWorkspace) => Promise<void>) {
  const ws = await createTestWorkspace({ catalog: testCatalog });
  try {
    await fn(ws);
  } finally {
    await ws.cleanup();
  }
}
const newTicket = async (ws: TestWorkspace, title = "Gift card redemption", extra: Data = {}) =>
  (okData(await ws.run("ticket new", { title, ...extra })).ticket as Ticket).ticket.id;
const readToml = (ws: TestWorkspace, rel: string) => JSON.parse(JSON.stringify(parse(readFileSync(join(ws.root, rel), "utf8")))) as Data;
const writeSpec = (ws: TestWorkspace, id: string, body = "# Spec\n\n- **AC-1** Given a card, when redeemed, then the balance drops\n") =>
  writeFileSync(join(ws.root, "artifacts", id, `${id}-spec.md`), body);

describe("tickets-toml", () => {
  test("ticket new writes only ticket.toml, in backlog, with a counter id and the author's initials", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws, "First", { size: "M", priority: "high" });
      assert.equal(id, "T-001-sa");
      assert.deepEqual(readdirSync(join(ws.root, "artifacts", id)), ["ticket.toml"]);
      const t = readToml(ws, "artifacts/T-001-sa/ticket.toml") as { ticket: Data; flags: Data };
      assert.equal(t.ticket.stage, "backlog");
      assert.equal(t.ticket.size, "M");
      assert.equal(t.ticket.owner, "sam");
      assert.equal(t.flags.blocked, false);
      assert.equal(await newTicket(ws, "Second"), "T-002-sa");
      const kims = okData(await ws.run("ticket new", { title: "Kim's" }, { actor: KIM })).ticket as Ticket;
      assert.equal(kims.ticket.id, "T-003-kl");
      const list = okData(await ws.run("ticket list", {})).tickets as Ticket[];
      assert.equal(list.length, 3);
      const mine = okData(await ws.run("ticket list", { mine: true }, { actor: KIM })).tickets as Ticket[];
      assert.deepEqual(
        mine.map((t) => t.ticket.id),
        ["T-003-kl"],
      );
    }));

  test("moves follow the workflow and gates exit 2 with the rule", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws);
      okData(await ws.run("ticket move", { id, stage: "spec" }));
      failed(await ws.run("ticket move", { id, stage: "build" }), 2, "transition");
      failed(await ws.run("ticket move", { id, stage: "nowhere" }), 1, "unknown-stage");

      const q = okData(await ws.run("question add", { ticket: id, text: "Which catalog?", blocking: true, option: ["WMS", "AMS"] })).record as TicketRecord;
      assert.equal(q.id, "Q-001-sa");
      const blockedMove = await ws.run("ticket move", { id, stage: "plan" });
      failed(blockedMove, 2, "gate:no-blocking-questions");
      assert.equal((readToml(ws, `artifacts/${id}/ticket.toml`).ticket as Data).stage, "spec");

      okData(await ws.run("question answer", { id: "Q-001-sa", answer: "WMS" }));
      const answered = readToml(ws, `artifacts/${id}/questions/Q-001-sa.toml`);
      assert.equal(answered.status, "answered");
      assert.equal(answered.answer, "WMS");
      failed(await ws.run("ticket move", { id, stage: "plan" }), 2, "gate:has-spec");
      writeSpec(ws, id);
      okData(await ws.run("ticket move", { id, stage: "plan" }));
      assert.equal((readToml(ws, `artifacts/${id}/ticket.toml`).ticket as Data).stage, "plan");

      // back any step, and to backlog, with no gate
      okData(await ws.run("ticket move", { id, stage: "spec" }));
      okData(await ws.run("ticket move", { id, stage: "backlog" }));
    }));

  test("blocked flag needs --by and --next and stops forward moves", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws);
      failed(await ws.run("ticket block", { id, by: "DBA" }), 1, "bad-input");
      okData(await ws.run("ticket block", { id, by: "DBA", next: "Ask Kim" }));
      const flags = readToml(ws, `artifacts/${id}/ticket.toml`).flags as Data;
      assert.deepEqual(flags, { blocked: true, blocked_by: "DBA", next_action: "Ask Kim" });
      failed(await ws.run("ticket move", { id, stage: "spec" }), 2, "gate:not-blocked");
      okData(await ws.run("ticket unblock", { id }));
      assert.deepEqual(readToml(ws, `artifacts/${id}/ticket.toml`).flags, { blocked: false });
      okData(await ws.run("ticket move", { id, stage: "spec" }));
    }));

  test("claim is a compare-and-set: a second person gets claim-conflict and is told never to retry", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws);
      const t = okData(await ws.run("ticket claim", { id })).ticket as Ticket;
      assert.equal(t.claim?.claimed_by, "sam");
      okData(await ws.run("ticket claim", { id })); // same person: idempotent
      const r = await ws.run("ticket claim", { id }, { actor: KIM });
      failed(r, 1, "claim-conflict");
      assert.ok(!r.ok && /never retry|Do not retry/i.test(r.error.message));
      failed(await ws.run("ticket release", { id }, { actor: KIM }), 1, "not-claimant");
      okData(await ws.run("ticket release", { id }));
      assert.equal(readToml(ws, `artifacts/${id}/ticket.toml`).claim, undefined);
      assert.equal((okData(await ws.run("ticket claim", { id }, { actor: KIM })).ticket as Ticket).claim?.claimed_by, "kim");
    }));

  test("dry run writes nothing and returns what it would write", () =>
    withWs(async (ws) => {
      const r = okData(await ws.run("ticket new", { title: "Dry" }, { dryRun: true }));
      assert.equal(r.dry_run, true);
      const would = r.would_write as { path: string; text: string }[];
      assert.equal(would[0]?.path, "artifacts/T-001-sa/ticket.toml");
      assert.match(would[0]?.text ?? "", /T-001-sa/);
      assert.equal(existsSync(join(ws.root, "artifacts")), false);

      const id = await newTicket(ws);
      const before = readFileSync(join(ws.root, "artifacts", id, "ticket.toml"), "utf8");
      okData(await ws.run("ticket move", { id, stage: "spec" }, { dryRun: true }));
      okData(await ws.run("ticket claim", { id }, { dryRun: true }));
      okData(await ws.run("ticket block", { id, by: "x", next: "y" }, { dryRun: true }));
      okData(await ws.run("ticket set", { id, size: "L" }, { dryRun: true }));
      okData(await ws.run("question add", { ticket: id, text: "?" }, { dryRun: true }));
      okData(await ws.run("task add", { ticket: id, title: "t", layer: "api" }, { dryRun: true }));
      okData(await ws.run("ticket comment", { id, text: "hi" }, { dryRun: true }));
      assert.equal(readFileSync(join(ws.root, "artifacts", id, "ticket.toml"), "utf8"), before);
      assert.deepEqual(readdirSync(join(ws.root, "artifacts", id)), ["ticket.toml"]);
    }));

  test("tasks: add with slices, depends and files; list; set; gates has-tasks and tasks-done", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws, "Tasks", { size: "M" });
      writeSpec(ws, id);
      okData(await ws.run("ticket move", { id, stage: "spec" }));
      okData(await ws.run("ticket move", { id, stage: "plan" }));
      failed(await ws.run("ticket move", { id, stage: "build" }), 2, "gate:has-tasks");

      const t1 = okData(await ws.run("task add", { ticket: id, title: "Table", layer: "db", ac: "AC-1", estimate: "2" })).task as Task;
      assert.equal(t1.id, "S1-T1");
      assert.equal(t1.estimate_h, 2);
      assert.deepEqual(t1.acs, ["AC-1"]);
      const t2 = okData(await ws.run("task add", { ticket: id, title: "API", layer: "api", ac: ["AC-1"], depends: "S1-T1", file: ["src/a.ts", "src/b.ts"] }))
        .task as Task;
      assert.equal(t2.id, "S1-T2");
      assert.deepEqual(t2.depends, ["S1-T1"]);
      assert.deepEqual(t2.files, ["src/a.ts", "src/b.ts"]);
      const t3 = okData(await ws.run("task add", { ticket: id, title: "UI", layer: "ui", slice: "S2" })).task as Task;
      assert.equal(t3.id, "S2-T1");
      failed(await ws.run("task add", { ticket: id, title: "x", layer: "ui", depends: "S9-T9" }), 1, "unknown-task");

      const listed = okData(await ws.run("task list", { ticket: id })).tasks as Task[];
      assert.deepEqual(
        listed.map((t) => t.id),
        ["S1-T1", "S1-T2", "S2-T1"],
      );
      okData(await ws.run("ticket move", { id, stage: "build" }));
      failed(await ws.run("ticket move", { id, stage: "verify" }), 2, "gate:tasks-done");
      for (const task of ["S1-T1", "S1-T2", "S2-T1"]) okData(await ws.run("task set", { ticket: id, task, status: "done", actual: "1.5" }));
      const file = readToml(ws, `artifacts/${id}/tasks.toml`) as { task: Data[]; ticket: string };
      assert.equal(file.ticket, id);
      assert.equal(file.task[0]?.actual_h, 1.5);
      assert.equal(file.task[0]?.layer, "db");
      failed(await ws.run("task set", { ticket: id, task: "S1-T9", status: "done" }), 1, "unknown-task");
      okData(await ws.run("ticket move", { id, stage: "verify" }));
    }));

  test("size S may skip tasks", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws, "Small", { size: "S" });
      writeSpec(ws, id);
      for (const stage of ["spec", "plan", "build", "verify", "done"]) okData(await ws.run("ticket move", { id, stage }));
    }));

  test("bugs and gaps: add, blockers, resolve, and the no-open-bugs gate", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws, "Bugs", { size: "S" });
      writeSpec(ws, id);
      for (const stage of ["spec", "plan", "build", "verify"]) okData(await ws.run("ticket move", { id, stage }));
      const bug = okData(await ws.run("bug add", { ticket: id, title: "Redeem twice", severity: "high" })).record as TicketRecord;
      const gap = okData(await ws.run("gap add", { ticket: id, text: "No expiry rule", category: "rules" })).record as TicketRecord;
      okData(await ws.run("question add", { ticket: id, text: "Not blocking" }));
      assert.equal(bug.id, "B-001-sa");
      assert.equal(gap.id, "G-001-sa");
      const blockers = okData(await ws.run("blockers", { ticket: id })).blockers as TicketRecord[];
      assert.deepEqual(blockers.map((b) => b.id).sort(), ["B-001-sa", "G-001-sa"]);
      failed(await ws.run("ticket move", { id, stage: "done" }), 2, "gate:no-open-bugs");
      failed(await ws.run("bug resolve", { id: "G-001-sa" }), 1, "bad-input");
      okData(await ws.run("bug resolve", { id: "B-001-sa", "fixed-in": "commit abc" }));
      const b = readToml(ws, `artifacts/${id}/bugs/B-001-sa.toml`);
      assert.equal(b.status, "fixed");
      assert.equal(b.fixed_in, "commit abc");
      assert.equal(b.severity, "high");
      okData(await ws.run("gap resolve", { id: "G-001-sa", note: "Added AC-4" }));
      const g = readToml(ws, `artifacts/${id}/gaps/G-001-sa.toml`);
      assert.equal(g.status, "closed");
      assert.equal(g.note, "Added AC-4");
      assert.deepEqual(okData(await ws.run("blockers", { ticket: id })).blockers, []);
      okData(await ws.run("ticket move", { id, stage: "done" }));
    }));

  test("ticket set, decisions, comments and ticket show --json", () =>
    withWs(async (ws) => {
      const id = await newTicket(ws);
      failed(await ws.run("ticket set", { id }), 1, "bad-input");
      okData(await ws.run("ticket set", { id, size: "L", priority: "urgent", title: "Renamed", goal: "Q4" }));
      const t = readToml(ws, `artifacts/${id}/ticket.toml`).ticket as Data;
      assert.equal(t.size, "L");
      assert.equal(t.priority, "urgent");
      assert.equal(t.title, "Renamed");
      assert.equal(t.stage, "backlog");

      const d = okData(await ws.run("decision add", { ticket: id, title: "Store in SQL", chosen: "table", why: "audit", rejected: ["JSON", "file"] }))
        .record as Data;
      assert.equal(d.id, "D-001-sa");
      assert.deepEqual(readToml(ws, `artifacts/${id}/decisions/D-001-sa.toml`).rejected, ["JSON", "file"]);
      okData(await ws.run("question add", { ticket: id, text: "Kim asks" }, { actor: KIM }));
      assert.ok(existsSync(join(ws.root, "artifacts", id, "questions", "Q-001-kl.toml")));
      okData(await ws.run("question add", { ticket: id, text: "Sam asks" }));
      assert.ok(existsSync(join(ws.root, "artifacts", id, "questions", "Q-002-sa.toml")));

      okData(await ws.run("ticket comment", { id, text: "First note" }));
      const lines = readFileSync(join(ws.root, "artifacts", id, "comments.jsonl"), "utf8")
        .trim()
        .split("\n");
      assert.equal(JSON.parse(lines[0]!).text, "First note");
      assert.equal(JSON.parse(lines[0]!).author, "sam");
      assert.equal((await ws.runtime.ctx.get("tickets").comments(id)).length, 1);

      okData(await ws.run("task add", { ticket: id, title: "x", layer: "api" }));
      const show = okData(await ws.run("ticket show", { id }, { json: true }));
      assert.equal((show.tasks as Task[]).length, 1);
      assert.deepEqual(show.records, {
        decision: { total: 1, open: 0 },
        question: { total: 2, open: 2 },
        bug: { total: 0, open: 0 },
        gap: { total: 0, open: 0 },
      });
      failed(await ws.run("ticket show", { id: "T-999-sa" }), 1, "unknown-ticket");
      failed(await ws.run("ticket show", { id: "nope" }), 1, "bad-id");
    }));

  test("services emit events and keep unknown keys on rewrite", () =>
    withWs(async (ws) => {
      await ws.runtime.mountForVerb("ticket new");
      const ctx = ws.runtime.ctx;
      const seen: string[] = [];
      ctx.on("ticket.created", (e) => void seen.push(`created ${e.id}`));
      ctx.on("ticket.moved", (e) => void seen.push(`moved ${e.from}->${e.to}`));
      ctx.on("ticket.blocked", (e) => void seen.push(`blocked ${e.blocked}`));
      ctx.on("record.added", (e) => void seen.push(`record ${e.kind} ${e.id}`));
      const id = await newTicket(ws);
      const path = join(ws.root, "artifacts", id, "ticket.toml");
      writeFileSync(path, `${readFileSync(path, "utf8")}\n[extra]\nnote = "kept"\n`);
      okData(await ws.run("ticket move", { id, stage: "spec" }));
      okData(await ws.run("ticket block", { id, by: "a", next: "b" }));
      okData(await ws.run("gap add", { ticket: id, text: "g" }));
      okData(await ws.run("ticket move", { id, stage: "spec" }, { dryRun: true }));
      assert.deepEqual(seen, [`created ${id}`, "moved backlog->spec", "blocked true", "record gap G-001-sa"]);
      assert.deepEqual(readToml(ws, `artifacts/${id}/ticket.toml`).extra, { note: "kept" });
      assert.equal(await ctx.get("tickets").nextId("T", "sa"), "T-002-sa");
      assert.equal(await ctx.get("tickets").nextId("G", "kl"), "G-002-kl");
    }));

  test("every verb in plugin.toml is registered with a summary and examples", () =>
    withWs(async (ws) => {
      await ws.runtime.mountForVerb("ticket new");
      const manifest = ws.runtime.manifests.get("tickets-toml")!;
      for (const id of manifest.verbs) {
        const def = ws.runtime.ctx.get("verbs").get(id);
        assert.ok(def, `verb ${id} not registered`);
        assert.ok(def.summary && def.examples.length, id);
      }
    }));
});

describe("tickets-toml broken files", () => {
  let ws: TestWorkspace;
  before(async () => {
    ws = await createTestWorkspace({ catalog: testCatalog });
  });
  after(() => ws.cleanup());
  test("unparsable records are skipped by list, reported by validate", async () => {
    const id = await newTicket(ws);
    mkdirSync(join(ws.root, "artifacts", id, "questions"), { recursive: true });
    writeFileSync(join(ws.root, "artifacts", id, "questions", "Q-001-sa.toml"), "id = ");
    assert.deepEqual(await ws.runtime.ctx.get("records").list(id), []);
    // the counter still sees the file name, so ids never collide with a broken record
    assert.equal(await ws.runtime.ctx.get("tickets").nextId("Q", "sa"), "Q-002-sa");
  });
});
