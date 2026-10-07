import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type {
  ActivityFeed,
  ApiResponse,
  ArtifactContent,
  Board,
  Overview,
  RunList,
  SearchResults,
  SkillList,
  TicketDetail,
  TicketList,
  WorkLogRange,
  WorkspaceSummary,
} from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp, hostAllowed } from "./app.ts";
import { classifyPath, ignored } from "./events.ts";

const DAY = "2026-10-07";
let ws: TestWorkspace;
let app: Hono;

async function get<T>(path: string, init?: RequestInit): Promise<{ status: number; body: ApiResponse<T>; res: Response }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json()) as ApiResponse<T>, res };
}
async function data<T>(path: string): Promise<T> {
  const r = await get<T>(path);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  return (r.body as { ok: true; data: T }).data;
}

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  // One failed and one good run record (runs/ is gitignored, so the fixture has none).
  mkdirSync(join(ws.root, "runs"), { recursive: true });
  const run = (id: string, ok: boolean, started: string) => ({
    id,
    ticket: "T-002-sa",
    runtime: "claude-code",
    agent: "builder",
    mode: "auto-review",
    model: null,
    started,
    ended: started,
    ok,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: null },
    failure_class: ok ? null : "auth",
    first_result_line: ok ? "done" : "not logged in",
  });
  writeFileSync(join(ws.root, "runs", "r-good.json"), JSON.stringify(run("r-good", true, "2026-10-07T09:00:00Z")));
  writeFileSync(join(ws.root, "runs", "r-bad.json"), JSON.stringify(run("r-bad", false, "2026-10-07T10:00:00Z")));
  writeFileSync(join(ws.root, "runs", "r-half.json.tmp-1"), "{");
  app = createApp(ws.runtime, { log: () => {} });
});
after(async () => {
  await ws.cleanup();
});

describe("api", () => {
  test("workspace", async () => {
    const d = await data<WorkspaceSummary>("/api/v1/workspace");
    assert.equal(d.name, "Test");
    assert.equal(d.console_name, "Test Console");
    assert.deepEqual(d.author, { id: "sam", name: "Sam Abbott", initials: "sa" });
    assert.equal(d.version.api, 1);
    assert.equal(typeof d.version.helmlock, "string");
    assert.ok(d.folders.some((f) => f.name === "knowledge" && f.layer === "workspace"));
  });

  test("board: stage counts and cards", async () => {
    const d = await data<Board>("/api/v1/board");
    const counts = Object.fromEntries(d.stages.map((s) => [s.id, s.count]));
    assert.deepEqual(counts, { backlog: 2, spec: 2, plan: 0, build: 1, verify: 0, done: 0 });
    assert.deepEqual(
      d.tickets.map((t) => t.id),
      ["T-001-sa", "T-002-sa", "T-003-sa", "T-004-sa", "T-005-sa"],
    );
    const t1 = d.tickets.find((t) => t.id === "T-001-sa")!;
    assert.equal(t1.open_questions, 1);
    assert.equal(t1.claimed_by, "sam");
    assert.equal(t1.size, "M");
    const t2 = d.tickets.find((t) => t.id === "T-002-sa")!;
    assert.equal(t2.tasks.total, 2);
    const t4 = d.tickets.find((t) => t.id === "T-004-sa")!;
    assert.equal(t4.blocked, true);
    assert.equal(typeof t4.blocked_by, "string");
    assert.equal(t4.open_bugs, 1);
  });

  test("tickets with filters", async () => {
    assert.deepEqual(
      (await data<TicketList>("/api/v1/tickets?stage=backlog")).map((t) => t.id),
      ["T-003-sa", "T-005-sa"],
    );
    assert.deepEqual(
      (await data<TicketList>("/api/v1/tickets?blocked=true")).map((t) => t.id),
      ["T-004-sa"],
    );
    assert.equal((await data<TicketList>("/api/v1/tickets")).length, 5);
    const bad = await get("/api/v1/tickets?blocked=maybe");
    assert.equal(bad.status, 400);
  });

  test("ticket detail", async () => {
    const d = await data<TicketDetail>("/api/v1/tickets/T-001-sa");
    assert.equal(d.card.id, "T-001-sa");
    assert.equal((d.ticket as { ticket: { id: string } }).ticket.id, "T-001-sa");
    assert.equal(d.digest.ticket.id, "T-001-sa");
    assert.deepEqual(d.records.map((r) => `${r.kind}:${r.id}`).sort(), ["decision:D-001-sa", "question:Q-001-sa"]);
    assert.ok(d.comments.length >= 1);
    assert.deepEqual(d.tasks, []);
    assert.equal(d.next_gate?.to, "plan");
    assert.equal(typeof d.next_gate?.gate.allowed, "boolean");
    // Ordered index: spec first, then records, other last.
    assert.deepEqual(
      d.artifacts.map((a) => a.id),
      ["T-001-sa-spec.md", "decisions~D-001-sa.toml", "questions~Q-001-sa.toml", "comments.jsonl", "ticket.toml"],
    );
    const spec = d.artifacts[0]!;
    assert.equal(spec.kind, "md");
    assert.equal(spec.group, "docs");
    assert.equal(spec.title, "Spec");
    assert.equal(spec.path, "artifacts/T-001-sa/T-001-sa-spec.md");
    assert.ok(spec.size > 0);
    const q = d.artifacts.find((a) => a.group === "questions")!;
    assert.match(q.title, /two gift cards/);
    assert.equal(d.artifacts.find((a) => a.id === "comments.jsonl")?.kind, "jsonl");
  });

  test("artifact index order across groups", async () => {
    const d = await data<TicketDetail>("/api/v1/tickets/T-002-sa");
    assert.deepEqual(
      d.artifacts.map((a) => a.id),
      ["T-002-sa-spec.md", "tasks.toml", "ticket.toml"],
    );
    assert.equal(d.artifacts[1]?.group, "tasks");
    assert.equal(d.tasks.length, 2);
    assert.equal(d.next_gate?.to, "verify");
    const d4 = await data<TicketDetail>("/api/v1/tickets/T-004-sa");
    assert.deepEqual(
      d4.artifacts.map((a) => a.group),
      ["bugs", "other"],
    );
  });

  test("artifact content", async () => {
    const d = await data<ArtifactContent>("/api/v1/tickets/T-001-sa/artifacts/decisions~D-001-sa.toml");
    assert.equal(d.ref.kind, "toml");
    assert.match(d.text, /id = "D-001-sa"/);
    const md = await data<ArtifactContent>("/api/v1/tickets/T-001-sa/artifacts/T-001-sa-spec.md");
    assert.equal(md.ref.kind, "md");
    assert.ok(md.text.length > 0);
  });

  test("path traversal and unknown artifacts are refused", async () => {
    for (const id of ["..~..~workspace.toml", "..~T-002-sa~ticket.toml", "%2E%2E%2F%2E%2E%2Fworkspace.toml", "..%5C..%5Cworkspace.toml", "C:%5Cwindows"]) {
      const r = await get(`/api/v1/tickets/T-001-sa/artifacts/${id}`);
      assert.equal(r.status, 400, id);
      assert.equal(r.body.ok, false);
      assert.equal((r.body as { ok: false; error: { rule: string } }).error.rule, "path-outside-ticket", id);
    }
    const missing = await get("/api/v1/tickets/T-001-sa/artifacts/nope.md");
    assert.equal(missing.status, 404);
  });

  test("unknown ticket: 404 envelope", async () => {
    const r = await get("/api/v1/tickets/T-999-sa");
    assert.equal(r.status, 404);
    assert.deepEqual(Object.keys(r.body).sort(), ["error", "ok"]);
    assert.equal(r.body.ok, false);
    const e = (r.body as { ok: false; error: { rule: string; message: string } }).error;
    assert.equal(e.rule, "unknown-ticket");
    assert.match(e.message, /T-999-sa/);
    const bad = await get("/api/v1/tickets/not-an-id");
    assert.equal(bad.status, 400);
    const nr = await get("/api/v1/nope");
    assert.equal(nr.status, 404);
    assert.equal((nr.body as { ok: false; error: { rule: string } }).error.rule, "not-found");
  });

  test("overview", async () => {
    const d = await data<Overview>(`/api/v1/overview?date=${DAY}`);
    const ids = d.needs_you.map((n) => n.id ?? n.ticket);
    assert.ok(ids.includes("Q-001-sa"), JSON.stringify(d.needs_you));
    assert.ok(ids.includes("T-004-sa"));
    assert.ok(ids.includes("r-bad"));
    assert.equal(d.needs_you.find((n) => n.id === "Q-001-sa")?.kind, "question");
    assert.equal(d.needs_you.find((n) => n.id === "T-004-sa")?.kind, "blocked");
    assert.equal(d.needs_you.find((n) => n.id === "r-bad")?.kind, "run-failed");
    assert.ok(!d.needs_you.some((n) => n.kind === "setup"));
    assert.equal(d.in_progress, 3);
    assert.equal(d.done_this_week, 0);
    assert.equal(d.stages.length, 6);
    assert.equal(d.today.date, DAY);
    assert.equal(d.today.worklog.length, 2);
    assert.ok(d.today.activity.length > 0);
    assert.deepEqual(
      d.runs.map((r) => r.id),
      ["r-bad", "r-good"],
    );
  });

  test("activity, worklog, runs, skills, search", async () => {
    const act = await data<ActivityFeed>(`/api/v1/activity?date=${DAY}&author=sam`);
    assert.ok(act.length > 5);
    assert.equal(act[0]?.verb, "ticket new");
    const wl = await data<WorkLogRange>(`/api/v1/worklog?from=2026-10-01&to=${DAY}`);
    assert.deepEqual(Object.keys(wl[0]!).sort(), ["author", "category", "date", "hours_alloc", "text", "ticket"]);
    assert.equal(
      wl.reduce((s, l) => s + l.hours_alloc, 0),
      8,
    );
    assert.equal((await get("/api/v1/worklog?from=yesterday")).status, 400);
    const runs = await data<RunList>("/api/v1/runs");
    const bad = runs.find((r) => r.id === "r-bad")!;
    assert.equal(bad.ok, false);
    assert.equal(bad.failure_class, "auth");
    assert.deepEqual(bad.usage, { input_tokens: 10, output_tokens: 5, cost_usd: null });
    assert.equal(runs.find((r) => r.id === "r-good")?.failure_class, undefined);
    const skills = await data<SkillList>("/api/v1/skills");
    assert.ok(skills.some((s) => s.name === "spec" && s.layer === "system"));
    const hits = await data<SearchResults>("/api/v1/search?q=gift");
    assert.ok(hits.some((h) => h.path.startsWith("artifacts/T-001-sa/")));
    assert.equal((await get("/api/v1/search?q=")).status, 400);
  });

  test("read-only and headers", async () => {
    const r = await get("/api/v1/board", { method: "POST" });
    assert.equal(r.status, 405);
    assert.equal(r.res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.res.headers.get("access-control-allow-origin"), null);
    const g = await app.request("/api/v1/board");
    assert.equal(g.headers.get("x-content-type-options"), "nosniff");
    assert.equal(g.headers.get("access-control-allow-origin"), null);
  });

  test("Host header check (DNS rebinding)", async () => {
    const evil = await get("/api/v1/workspace", { headers: { host: "evil.example:4317" } });
    assert.equal(evil.status, 403);
    assert.equal((evil.body as { ok: false; error: { rule: string } }).error.rule, "bad-host");
    assert.equal((await app.request("http://attacker.test/api/v1/board")).status, 403);
    assert.equal((await app.request("/api/v1/workspace", { headers: { host: "127.0.0.1:4317" } })).status, 200);
    assert.equal(hostAllowed("localhost:4317", 4317), true);
    assert.equal(hostAllowed("127.0.0.1:4317", 4317), true);
    assert.equal(hostAllowed("[::1]:4317", 4317), true);
    assert.equal(hostAllowed("127.0.0.1:9999", 4317), false);
    assert.equal(hostAllowed("localhost.evil.com:4317", 4317), false);
    assert.equal(hostAllowed(undefined, 4317), false);
  });

  test("UI: not-built page for non-API routes", async () => {
    const a = createApp(ws.runtime, { uiDir: join(ws.root, "no-ui"), log: () => {} });
    const r = await a.request("/t/T-001-sa");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /pnpm --filter @helmlock\/ui build/);
  });

  test("UI: dist files and SPA fallback", async () => {
    const dist = join(ws.root, "_ui");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>ui</title>");
    writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
    const a = createApp(ws.runtime, { uiDir: dist, log: () => {} });
    const js = await a.request("/assets/app.js");
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.equal(await js.text(), "console.log(1)");
    const spa = await a.request("/board/T-001-sa");
    assert.match(await spa.text(), /<title>ui<\/title>/);
    assert.equal((await a.request("/assets/missing.js")).status, 404);
    const outside = await a.request("/%2e%2e/workspace.toml");
    assert.doesNotMatch(await outside.text(), /schema_version/);
  });

  test("warm responses under 50 ms (F109)", async () => {
    const paths = ["/api/v1/board", "/api/v1/overview", "/api/v1/tickets/T-001-sa", "/api/v1/workspace", "/api/v1/tickets"];
    for (const p of paths) await app.request(p); // warm-up
    for (const p of paths) {
      const t = performance.now();
      const r = await app.request(p);
      const ms = performance.now() - t;
      assert.equal(r.status, 200);
      assert.ok(ms < 50, `${p} took ${ms.toFixed(1)} ms`);
    }
  });
});

describe("change mapping", () => {
  test("paths to areas and tickets", () => {
    assert.deepEqual(classifyPath("artifacts/T-001-sa/comments.jsonl"), { areas: ["tickets"], ticket: "T-001-sa" });
    assert.deepEqual(classifyPath("artifacts/T-001-sa/questions/Q-001-sa.toml"), { areas: ["records", "tickets"], ticket: "T-001-sa" });
    assert.deepEqual(classifyPath("artifacts/T-002-sa/tasks.toml"), { areas: ["tasks", "tickets"], ticket: "T-002-sa" });
    assert.deepEqual(classifyPath("logs/2026-10/2026-10-07.sam.toml"), { areas: ["worklog"] });
    assert.deepEqual(classifyPath("activity/2026-10/07.sam.jsonl"), { areas: ["activity"] });
    assert.deepEqual(classifyPath("runs/abc.json"), { areas: ["runs"] });
    assert.deepEqual(classifyPath("workspace.toml"), { areas: ["workspace"] });
    assert.deepEqual(classifyPath(".claude/skills/x/SKILL.md"), { areas: ["skills"] });
    assert.equal(ignored(".git/index"), true);
    assert.equal(ignored("node_modules/x/a.js"), true);
    assert.equal(ignored(".hl-cache/idx"), true);
    assert.equal(ignored("runs/abc.json.tmp"), true);
    assert.equal(ignored("artifacts/T-001-sa/ticket.toml.tmp-123"), true);
    assert.equal(ignored("artifacts/T-001-sa/ticket.toml.lock"), true);
    assert.equal(ignored("artifacts/T-001-sa/ticket.toml"), false);
  });
});
