// Crew plugin: defaults from the agent pack, `crew set`, next(), hand-off briefs (fresh vs delta) and say() routing.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Actor } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { FAKE_MODEL, type FakeRunManager, fakeCatalog, fakeRunManager } from "./crew-fakes.ts";
import { type Crew, type CrewRoleFull, DEFAULT_STAGE_ROLES, mentionedRole } from "./index.ts";

const SAM: Actor = { kind: "person", id: "sam", onBehalfOf: "sam" };
let ws: TestWorkspace;
let rm: FakeRunManager;
let crew: Crew;
let wsToml: string;

before(async () => {
  rm = fakeRunManager();
  ws = await createTestWorkspace({ catalog: fakeCatalog(rm), fixture: "ws-demo" });
  await ws.runtime.mountAll();
  crew = ws.runtime.ctx.get("crew") as Crew;
  wsToml = readFileSync(join(ws.root, "workspace.toml"), "utf8");
  // A done ticket for next().
  const t5 = join(ws.root, "artifacts/T-005-sa/ticket.toml");
  writeFileSync(t5, readFileSync(t5, "utf8").replace('stage = "backlog"', 'stage = "done"'));
});
after(() => ws.cleanup());
beforeEach(() => {
  rm.runs.length = 0;
  rm.starts.length = 0;
  rm.says.length = 0;
  rm.sayMode = "live";
  writeFileSync(join(ws.root, "workspace.toml"), wsToml);
  crew.resetEngineCache();
});

describe("crew defaults", () => {
  test("roles come from the agent pack; build roles get a worktree and auto-review", async () => {
    const roles = await crew.rolesFull();
    assert.deepEqual(roles.map((r) => r.id).sort(), ["analyst", "builder", "deployer", "fixer", "planner", "verifier"]);
    const b = roles.find((r) => r.id === "builder") as CrewRoleFull;
    assert.equal(b.label, "Builder");
    assert.match(b.description ?? "", /Implementation owner/);
    assert.equal(b.engine, "claude-code");
    assert.equal(b.worktree, true);
    assert.equal(b.mode, "auto-review");
    const a = roles.find((r) => r.id === "analyst") as CrewRoleFull;
    assert.equal(a.worktree, false);
    assert.equal(a.mode, "ask");
    assert.ok(roles.find((r) => r.id === "fixer")?.worktree);
    // The contract view has no mode.
    assert.ok(!("mode" in ((await crew.roles())[0] as object)));
    assert.deepEqual(await crew.stageRoles(), DEFAULT_STAGE_ROLES);
  });

  test("the knowledge repo's agent files override and extend the pack; the crew row overrides engines live", async () => {
    mkdirSync(join(ws.root, ".claude/agents"), { recursive: true });
    writeFileSync(join(ws.root, ".claude/agents/designer.md"), "---\nname: designer\ndescription: Screens and flows.\n---\n# Designer\n");
    writeFileSync(join(ws.root, ".claude/agents/analyst.md"), "---\nname: analyst\ndescription: Our own analyst.\n---\n");
    writeFileSync(
      join(ws.root, "workspace.toml"),
      `${wsToml}\n[[plugin]]\nid = "crew"\n\n[plugin.config.stage_roles]\nbacklog = "designer"\n\n[[plugin.config.roles]]\nid = "verifier"\nengine = "cursor"\n`,
    );
    try {
      const roles = await crew.rolesFull();
      assert.equal(roles.find((r) => r.id === "designer")?.description, "Screens and flows.");
      assert.equal(roles.find((r) => r.id === "analyst")?.description, "Our own analyst.");
      assert.equal(roles.find((r) => r.id === "verifier")?.engine, "cursor");
      assert.equal((await crew.stageRoles()).backlog, "designer");
      assert.equal((await crew.stageRoles()).build, "builder");
    } finally {
      rmSync(join(ws.root, ".claude"), { recursive: true, force: true });
    }
  });

  test("engines carry capabilities and a cached test; an engine without test() uses detect()", async () => {
    const e = await crew.engines();
    assert.deepEqual(
      e.map((x) => [x.id, x.test.ok]),
      [
        ["claude-code", true],
        ["cursor", false],
        ["loop", true],
      ],
    );
    assert.equal(e.find((x) => x.id === "claude-code")?.capabilities.resume, true);
    assert.equal(e.find((x) => x.id === "cursor")?.capabilities.steer, false);
  });
});

describe("crew set", () => {
  test("dry run writes nothing; a real run writes the crew row and crew show reflects it", async () => {
    const dry = await ws.run("crew set", { role: "verifier", engine: "loop" }, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.match(dry.text ?? "", /would set verifier: loop/);
    assert.equal(readFileSync(join(ws.root, "workspace.toml"), "utf8"), wsToml);

    const res = await ws.run("crew set", { role: "verifier", engine: "loop", model: FAKE_MODEL.id });
    assert.ok(res.ok, JSON.stringify(res));
    const text = readFileSync(join(ws.root, "workspace.toml"), "utf8");
    assert.match(text, /\[\[plugin\]\]\s*\nid = "crew"/);
    assert.match(text, /engine = "loop"/);
    assert.match(text, /\[workspace\]/, "other tables are kept");
    const show = await ws.run("crew show", {});
    assert.ok(show.ok);
    const v = (show.data as { roles: CrewRoleFull[] }).roles.find((r) => r.id === "verifier");
    assert.equal(v?.engine, "loop");
    assert.equal(v?.model, FAKE_MODEL.id);
    assert.match(show.text ?? "", /verifier\s+loop \(or\/deepseek-chat\)/);

    // Clearing the model and setting the worktree flag keeps the engine.
    const res2 = await ws.run("crew set", { role: "verifier", model: "", worktree: "true" });
    assert.ok(res2.ok, JSON.stringify(res2));
    const v2 = (await crew.rolesFull()).find((r) => r.id === "verifier");
    assert.equal(v2?.engine, "loop");
    assert.equal(v2?.model, undefined);
    assert.equal(v2?.worktree, true);
    assert.equal(v2?.mode, "auto-review");
  });

  test("an unknown engine, an unknown role and an unknown loop model are refused", async () => {
    const e = await ws.run("crew set", { role: "builder", engine: "codex" });
    assert.equal(e.ok, false);
    assert.equal(!e.ok && e.error.rule, "unknown-engine");
    const r = await ws.run("crew set", { role: "nobody", engine: "loop" });
    assert.equal(!r.ok && r.error.rule, "unknown-role");
    const m = await ws.run("crew set", { role: "analyst", engine: "loop", model: "no/such-model" });
    assert.equal(!m.ok && m.error.rule, "unknown-model");
    assert.match(!m.ok ? (m.error.fix ?? "") : "", /or\/deepseek-chat/);
    // A CLI engine names its own models: not checked.
    const c = await ws.run("crew set", { role: "analyst", engine: "claude-code", model: "opus" }, { dryRun: true });
    assert.ok(c.ok, JSON.stringify(c));
    const none = await ws.run("crew set", { role: "analyst" });
    assert.equal(!none.ok && none.error.rule, "bad-request");
    assert.equal(readFileSync(join(ws.root, "workspace.toml"), "utf8"), wsToml);
  });
});

describe("next step", () => {
  test("from the stage map; undefined at done", async () => {
    assert.deepEqual(await crew.next("T-002-sa"), { role: "builder", label: "Builder", engine: "claude-code", reason: "Stage build: Builder builds" });
    assert.equal((await crew.next("T-001-sa"))?.role, "analyst");
    assert.equal((await crew.next("T-003-sa"))?.role, "analyst");
    assert.equal(await crew.next("T-005-sa"), undefined);
  });

  test("the last outcome's next_role wins when it ended done or review", async () => {
    rm.seed({
      id: "r-old",
      ticket: "T-002-sa",
      role: "builder",
      started: "2026-10-01T10:00:00Z",
      outcome: { outcome: "review", summary: "slice 1 built", next: "verify slice 1", next_role: "verifier" },
    });
    assert.deepEqual(await crew.next("T-002-sa"), { role: "verifier", label: "Verifier", engine: "claude-code", reason: "Builder suggested: verify slice 1" });
    rm.seed({
      id: "r-new",
      ticket: "T-002-sa",
      role: "builder",
      started: "2026-10-02T10:00:00Z",
      outcome: { outcome: "blocked", summary: "no login", next_role: "verifier" },
    });
    assert.equal((await crew.next("T-002-sa"))?.role, "builder", "a blocked outcome falls back to the stage");
    rm.seed({
      id: "r-x",
      ticket: "T-002-sa",
      role: "builder",
      started: "2026-10-03T10:00:00Z",
      outcome: { outcome: "done", summary: "ok", next_role: "ghost" },
    });
    assert.equal((await crew.next("T-002-sa"))?.role, "builder", "an unknown role falls back to the stage");
  });
});

describe("hand-off", () => {
  test("a fresh session gets the full brief and the role's defaults", async () => {
    const run = await crew.handoff({ ticket: "T-002-sa", message: "start with the export button" }, SAM, "console");
    assert.equal(run.role, "builder");
    const o = rm.starts[0];
    assert.ok(o);
    assert.equal(o.runtime, "claude-code");
    assert.equal(o.role, "builder");
    assert.equal(o.agent, "builder");
    assert.equal(o.ticket, "T-002-sa");
    assert.equal(o.worktree, true);
    assert.equal(o.mode, "auto-review");
    assert.equal(o.origin, "console");
    assert.deepEqual(o.actor, SAM);
    assert.equal(o.fresh, undefined);
    assert.match(o.prompt, /^You are the Builder on ticket T-002-sa\./);
    assert.match(o.prompt, /Ticket: Export orders to CSV/);
    assert.match(o.prompt, /Context \(hl context T-002-sa\):\nT-002-sa {2}Export orders to CSV/);
    assert.match(o.prompt, /Message from sam: start with the export button/);
    assert.match(o.prompt, /hl run report --outcome done\|review\|blocked\|needs-input/);
  });

  test("a resumed session gets the delta: comments and outcomes since its last run", async () => {
    rm.seed({
      id: "r-a",
      ticket: "T-001-sa",
      role: "analyst",
      started: "2026-10-01T09:00:00Z",
      ended: "2026-10-01T09:30:00Z",
      outcome: { outcome: "review", summary: "spec v1" },
    });
    rm.seed({
      id: "r-b",
      ticket: "T-001-sa",
      role: "planner",
      started: "2026-10-08T09:00:00Z",
      ended: "2026-10-08T09:10:00Z",
      outcome: { outcome: "needs-input", summary: "which carriers?", next: "answer Q-001" },
    });
    await crew.handoff({ ticket: "T-001-sa", role: "analyst", message: "add the refund rule" }, SAM);
    const p = rm.starts[0]?.prompt ?? "";
    assert.match(p, /^Back on ticket T-001-sa as the Analyst \(same session\)/);
    assert.match(p, /Since your last run \(2026-10-01T09:30:00Z\):/);
    assert.match(p, /- sam: Spec draft ready for review/, "the fixture comment from 2026-10-07");
    assert.match(p, /- Planner ended needs-input: which carriers\? \(next: answer Q-001\)/);
    assert.ok(!p.includes("spec v1"), "its own earlier outcome is not news");
    assert.match(p, /Message from sam: add the refund rule/);
    assert.match(p, /hl run report/);
    assert.ok(!p.includes("Context (hl context"));
    assert.equal(rm.starts[0]?.mode, "ask");
    assert.equal(rm.starts[0]?.worktree, false);

    await crew.handoff({ ticket: "T-001-sa", role: "analyst", fresh: true }, SAM);
    assert.match(rm.starts[1]?.prompt ?? "", /^You are the Analyst/);
    assert.equal(rm.starts[1]?.fresh, true);
  });

  test("overrides, unknown roles and failing engines", async () => {
    await crew.handoff({ ticket: "T-002-sa", role: "verifier", engine: "loop", model: FAKE_MODEL.id }, SAM);
    assert.equal(rm.starts[0]?.runtime, "loop");
    assert.equal(rm.starts[0]?.model, FAKE_MODEL.id);
    await assert.rejects(crew.handoff({ ticket: "T-002-sa", role: "ghost" }, SAM), (e: { rule?: string }) => e.rule === "unknown-role");
    await assert.rejects(
      crew.handoff({ ticket: "T-002-sa", role: "verifier", engine: "cursor" }, SAM),
      (e: { rule?: string; message: string; fix?: string }) =>
        e.rule === "engine-not-ready" && /not signed in/.test(e.message) && /crew set verifier/.test(e.fix ?? ""),
    );
    await assert.rejects(crew.handoff({ ticket: "T-005-sa" }, SAM), (e: { rule?: string }) => e.rule === "no-next-role");
    assert.equal(rm.starts.length, 1);
  });
});

describe("say", () => {
  test("a live run is steered, or queued when the engine cannot steer", async () => {
    rm.seed({ id: "r-live", ticket: "T-002-sa", role: "builder", status: "running" });
    assert.equal((await crew.say("T-002-sa", "also add a header row", SAM)).action, "steered");
    rm.sayMode = "queued";
    const q = await crew.say("T-002-sa", "and a footer", SAM);
    assert.equal(q.action, "queued");
    assert.equal(q.run?.id, "r-live");
    assert.deepEqual(rm.says[0], { id: "r-live", text: "also add a header row", by: "sam" });
    assert.equal(rm.starts.length, 0);
  });

  test("@role hands off to that role with the text as the message", async () => {
    rm.seed({ id: "r-done", ticket: "T-002-sa", role: "builder", status: "done", started: "2026-10-01T10:00:00Z" });
    const r = await crew.say("T-002-sa", "@verifier check slice 1 please", SAM);
    assert.equal(r.action, "handed-off");
    assert.equal(rm.starts[0]?.role, "verifier");
    assert.match(rm.starts[0]?.prompt ?? "", /Message from sam: @verifier check slice 1 please/);
    assert.equal(mentionedRole("mail me at a@builder.io", ["builder"]), undefined);
    assert.equal(mentionedRole("thanks, @Planner", ["planner"]), "planner");
  });

  test("without a mention it goes back to the last role, resuming its session", async () => {
    rm.seed({ id: "r-done", ticket: "T-002-sa", role: "builder", status: "done", started: "2026-10-01T10:00:00Z", ended: "2026-10-01T11:00:00Z" });
    const r = await crew.say("T-002-sa", "the totals are wrong", SAM);
    assert.equal(r.action, "handed-off");
    assert.equal(rm.starts[0]?.role, "builder");
    assert.match(rm.starts[0]?.prompt ?? "", /^Back on ticket T-002-sa as the Builder/);
  });

  test("with no run on the ticket it becomes a comment", async () => {
    const r = await crew.say("T-003-sa", "parking this until the login vendor answers", SAM);
    assert.deepEqual(r, { action: "commented" });
    const comments = await ws.runtime.ctx.get("tickets").comments("T-003-sa");
    assert.equal(comments.at(-1)?.text, "parking this until the login vendor answers");
    assert.equal(comments.at(-1)?.author, "sam");
    assert.equal(rm.starts.length, 0);
  });
});
