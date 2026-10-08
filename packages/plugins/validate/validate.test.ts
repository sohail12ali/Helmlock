import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Finding, ValidateService } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { testCatalog } from "../tickets-toml/testing-fakes.ts";

const errors = (f: Finding[]) => f.filter((x) => x.level === "error");
const rules = (f: Finding[]) => errors(f).map((x) => x.rule);

describe("validate", () => {
  let ws: TestWorkspace;
  let v: ValidateService;
  before(async () => {
    ws = await createTestWorkspace({ catalog: testCatalog, fixture: "s3-validate" });
    await ws.runtime.mountForVerb("validate");
    v = ws.runtime.ctx.get("validate");
  });
  after(() => ws.cleanup());

  test("catches the six seeded faults", async () => {
    const all = await v.all();
    const has = (rule: string, file: string) =>
      assert.ok(
        errors(all).some((f) => f.rule === rule && f.file === file),
        `missing ${rule} on ${file}\n${JSON.stringify(errors(all), null, 1)}`,
      );
    has("ticket-id", "artifacts/T-1-x/ticket.toml"); // 1 bad id
    has("record-id", "artifacts/T-002-sa/decisions/D-001-sa.toml"); // 2 record id vs file name
    has("task-unknown-ac", "artifacts/T-002-sa/tasks.toml"); // 3 task cites AC-9
    has("ac-no-task", "artifacts/T-002-sa/T-002-sa-spec.md"); // 4 AC-2 has no task, stage build
    has("blocked-incomplete", "artifacts/T-003-sa/ticket.toml"); // 5 blocked without next_action
    has("record-parse", "artifacts/T-003-sa/questions/Q-001-sa.toml"); // 6 unparsable record
    assert.ok(
      errors(all)
        .find((f) => f.rule === "ac-no-task")
        ?.message.includes("AC-2"),
    );
    assert.ok(!errors(all).some((f) => f.rule === "ac-no-task" && f.message.includes("AC-1")));
  });

  test("a clean ticket has no findings", async () => {
    assert.deepEqual(await v.ticket("T-004-sa"), []);
  });

  test("file() runs only the checks for that file", async () => {
    assert.deepEqual(rules(await v.file("artifacts/T-002-sa/decisions/D-001-sa.toml")), ["record-id"]);
    assert.deepEqual(rules(await v.file(join(ws.root, "artifacts", "T-003-sa", "questions", "Q-001-sa.toml"))), ["record-parse"]);
    assert.deepEqual(rules(await v.file("artifacts/T-003-sa/ticket.toml")), ["blocked-incomplete"]);
    assert.deepEqual(rules(await v.file("artifacts/T-1-x/ticket.toml")).sort(), ["ticket-id", "ticket-id"]);
    assert.deepEqual(rules(await v.file("artifacts/T-002-sa/tasks.toml")).sort(), ["ac-no-task", "task-unknown-ac"]);
    assert.deepEqual(rules(await v.file("artifacts/T-002-sa/T-002-sa-spec.md")).sort(), ["ac-no-task", "task-unknown-ac"]);
    assert.deepEqual(await v.file("artifacts/T-004-sa/tasks.toml"), []);
    assert.deepEqual(await v.file("workspace.toml"), []);
    assert.deepEqual(await v.file("artifacts/T-004-sa/missing.md"), []);
  });

  test("file() is fast (budget 300 ms; the check alone should be a few ms)", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) await v.file("artifacts/T-002-sa/tasks.toml");
    const each = (performance.now() - t0) / 20;
    assert.ok(each < 150, `file() took ${each.toFixed(1)} ms`);
  });

  test("layout: unknown files and folders warn, binaries outside source/ warn", async () => {
    const dir = join(ws.root, "artifacts", "T-004-sa");
    mkdirSync(join(dir, "scratch"), { recursive: true });
    writeFileSync(join(dir, "scratch", "x.md"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "brief.docx"), "x");
    mkdirSync(join(dir, "source"), { recursive: true });
    writeFileSync(join(dir, "source", "input.docx"), "x");
    const f = await v.ticket("T-004-sa");
    assert.deepEqual(errors(f), []);
    const warns = f.map((x) => `${x.rule} ${x.file}`).sort();
    assert.deepEqual(warns, [
      "binary-outside-source artifacts/T-004-sa/brief.docx",
      "layout artifacts/T-004-sa/brief.docx",
      "layout artifacts/T-004-sa/notes.txt",
      "layout artifacts/T-004-sa/scratch",
    ]);
    assert.equal((await v.file("artifacts/T-004-sa/notes.txt"))[0]?.rule, "layout");
    assert.deepEqual(await v.file("artifacts/T-004-sa/source/input.docx"), []);
  });

  test("the verb exits 1 on errors and 0 on a clean ticket", async () => {
    const bad = await ws.run("validate", { ticket: "T-002-sa" });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.code, 1);
      assert.match(bad.error.message, /3 error\(s\)/);
    }
    const changed = await ws.run("validate", { changed: "artifacts/T-003-sa/ticket.toml" });
    assert.equal(changed.ok, false);
    const good = await ws.run("validate", { ticket: "T-004-sa" }, { json: true });
    assert.equal(good.ok, true, JSON.stringify(good));
  });
});

describe("validate on tickets written by tickets-toml", () => {
  test("a ticket built through the verbs validates clean; a claim with missing fields is an error", async () => {
    const ws = await createTestWorkspace({ catalog: testCatalog });
    try {
      const r = await ws.run("ticket new", { title: "Through verbs", size: "M" });
      assert.ok(r.ok);
      await ws.run("ticket claim", { id: "T-001-sa" });
      await ws.run("question add", { ticket: "T-001-sa", text: "Q?", blocking: true });
      await ws.run("decision add", { ticket: "T-001-sa", title: "D", rejected: ["x"] });
      await ws.run("bug add", { ticket: "T-001-sa", title: "B" });
      await ws.run("gap add", { ticket: "T-001-sa", text: "G" });
      await ws.run("task add", { ticket: "T-001-sa", title: "T", layer: "spike" });
      await ws.run("ticket comment", { id: "T-001-sa", text: "c" });
      await ws.runtime.mountForVerb("validate");
      const svc = ws.runtime.ctx.get("validate");
      assert.deepEqual(await svc.ticket("T-001-sa"), []);
      writeFileSync(
        join(ws.root, "artifacts", "T-001-sa", "ticket.toml"),
        'schema_version = 1\n[ticket]\nid = "T-001-sa"\ntitle = "x"\nstage = "spec"\ncreated = "a"\nupdated = "a"\n[claim]\nclaimed_by = "sam"\n',
      );
      assert.ok(rules(await svc.file("artifacts/T-001-sa/ticket.toml")).includes("claim-fields"));
      assert.ok(rules(await svc.ticket("T-001-sa")).includes("ticket-schema"));
    } finally {
      await ws.cleanup();
    }
  });
});
