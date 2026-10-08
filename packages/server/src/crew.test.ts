// Milestone 8 routes: GET /crew, the ticket thread (merge order, next, live), POST handoff and say (write rules).
// The run manager and the engines are fakes (packages/plugins/crew/crew-fakes.ts): no agent CLI runs.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { type ApiResponse, type CrewView, type NextStep, type RunState, type SayResult, type TicketThread, WRITE_HEADER } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { type FakeRunManager, fakeCatalog, fakeRunManager } from "@helmlock/plugins/crew/crew-fakes.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { mergeThread } from "./thread.ts";

const W = { "content-type": "application/json", [WRITE_HEADER]: "1" };
let ws: TestWorkspace;
let app: Hono;
let rm: FakeRunManager;

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = W) {
  const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
const dataOf = <T>(r: { status: number; body: ApiResponse<T> }) => {
  assert.ok(r.body.ok, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
};
const errOf = (r: { body: ApiResponse<unknown> }) => (r.body as { ok: false; error: { rule: string; message: string } }).error;

before(async () => {
  rm = fakeRunManager();
  ws = await createTestWorkspace({ catalog: fakeCatalog(rm), fixture: "ws-demo" });
  app = createApp(ws.runtime, { log: () => {}, hookToken: "tok" });
});
after(() => ws.cleanup());
beforeEach(() => {
  rm.runs.length = 0;
  rm.starts.length = 0;
  rm.says.length = 0;
});

describe("GET /crew", () => {
  test("roles with engine test, current and last runs, live count, cap and needs-you", async () => {
    rm.seed({ id: "r-live", ticket: "T-002-sa", role: "builder", status: "running", started: "2026-10-08T10:00:00Z" });
    rm.seed({ id: "r-q", ticket: "T-004-sa", role: "builder", status: "queued", started: "2026-10-08T10:05:00Z" });
    rm.seed({
      id: "r-ask",
      ticket: "T-001-sa",
      role: "analyst",
      status: "done",
      started: "2026-10-08T09:00:00Z",
      outcome: { outcome: "needs-input", summary: "which carriers apply?" },
    });
    rm.seed({ id: "r-old", ticket: "T-003-sa", role: "analyst", status: "done", started: "2026-10-01T09:00:00Z", outcome: { outcome: "done", summary: "ok" } });
    // Settings > Crew: the verifier runs on Cursor, which fails its test here.
    const set = await call("POST", "/api/v1/verbs/crew/set", { input: { role: "verifier", engine: "cursor" } });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    const v = dataOf(await call<CrewView>("GET", "/api/v1/crew"));
    const builder = v.roles.find((r) => r.id === "builder");
    assert.deepEqual(
      builder?.current.map((r) => r.id),
      ["r-q", "r-live"],
    );
    assert.equal(builder?.engine_ok, true);
    assert.equal(builder?.worktree, true);
    const analyst = v.roles.find((r) => r.id === "analyst");
    assert.equal(analyst?.last?.id, "r-ask");
    assert.equal(analyst?.current.length, 0);
    const verifier = v.roles.find((r) => r.id === "verifier");
    assert.equal(verifier?.engine, "cursor");
    assert.equal(verifier?.engine_ok, false);
    assert.equal(verifier?.engine_problem, "not signed in");
    assert.deepEqual(
      v.engines.map((e) => e.id),
      ["claude-code", "cursor", "loop"],
    );
    assert.equal(v.live, 1);
    assert.equal(v.max_live, 2);
    const ask = v.needs_you.find((n) => n.id === "r-ask");
    assert.equal(ask?.title, "The Analyst needs input on T-001-sa");
    assert.equal(ask?.detail, "which carriers apply?");
    assert.ok(!v.needs_you.some((n) => n.id === "r-old"));
    assert.ok(
      v.needs_you.some((n) => n.id === "Q-001-sa"),
      "open blocking questions, as on the Overview",
    );
  });
});

describe("ticket thread", () => {
  test("comments and runs merge oldest first; next and live are set", async () => {
    // The fixture comment on T-001-sa is at 2026-10-07T10:09:31.574Z.
    rm.seed({ id: "r-before", ticket: "T-001-sa", role: "analyst", status: "done", started: "2026-10-06T08:00:00Z" });
    rm.seed({ id: "r-after", ticket: "T-001-sa", role: "analyst", status: "running", started: "2026-10-08T08:00:00Z" });
    rm.seed({ id: "r-other", ticket: "T-002-sa", role: "builder", status: "done", started: "2026-10-07T00:00:00Z" });
    const t = dataOf(await call<TicketThread>("GET", "/api/v1/tickets/T-001-sa/thread"));
    assert.equal(t.ticket, "T-001-sa");
    assert.deepEqual(
      t.items.map((i) => (i.kind === "run" ? i.run.id : `comment:${i.author}`)),
      ["r-before", "comment:sam", "r-after"],
    );
    assert.equal(t.live?.id, "r-after");
    assert.equal(t.next?.role, "analyst");
    assert.equal(t.next?.reason, "Stage spec: Analyst writes the spec");

    const n = dataOf(await call<NextStep | null>("GET", "/api/v1/tickets/T-002-sa/next"));
    assert.equal(n?.role, "builder");
    assert.equal((await call("GET", "/api/v1/tickets/T-999-sa/thread")).status, 404);
  });

  test("a comment and a run at the same instant keep the comment first", () => {
    const ts = "2026-10-08T10:00:00.000Z";
    const run = { id: "r1", runtime: "loop", mode: "ask", status: "done", started: ts } as RunState;
    const items = mergeThread([{ ts, author: "sam", text: "go", run: "r0" }], [run]);
    assert.deepEqual(
      items.map((i) => i.kind),
      ["comment", "run"],
    );
    assert.equal(items[0]?.kind === "comment" && items[0].run, "r0");
  });
});

describe("hand-off and say", () => {
  test("writes need the header and JSON; the run records the person as responsible", async () => {
    const noHeader = await call("POST", "/api/v1/tickets/T-002-sa/handoff", {}, { "content-type": "application/json" });
    assert.equal(noHeader.status, 403);
    assert.equal(errOf(noHeader).rule, "write-header-missing");
    const cross = await call("POST", "/api/v1/tickets/T-002-sa/say", { text: "hi" }, { ...W, origin: "http://evil.example" });
    assert.equal(cross.status, 403);
    const bad = await call("POST", "/api/v1/tickets/T-002-sa/handoff", { role: "builder", extra: 1 });
    assert.equal(bad.status, 400);
    assert.equal((await call("POST", "/api/v1/tickets/T-002-sa/other", {})).status, 405);
    assert.equal(rm.starts.length, 0);

    const r = await call<RunState>("POST", "/api/v1/tickets/T-002-sa/handoff", { message: "go" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(dataOf(r).role, "builder");
    const o = rm.starts[0];
    assert.deepEqual(o?.actor, { kind: "person", id: "sam", onBehalfOf: "sam" });
    assert.equal(o?.origin, "console");
    assert.equal(o?.env?.HL_HOOK_TOKEN, "tok");
    assert.ok(o?.env?.HL_SERVER_URL);

    const refused = await call("POST", "/api/v1/tickets/T-002-sa/handoff", { role: "verifier", engine: "cursor" });
    assert.equal(refused.status, 422);
    assert.equal(errOf(refused).rule, "engine-not-ready");
    const unknown = await call("POST", "/api/v1/tickets/T-002-sa/handoff", { role: "ghost" });
    assert.equal(unknown.status, 422);
  });

  test("say steers a live run, hands off on @role and otherwise comments", async () => {
    rm.seed({ id: "r-live", ticket: "T-002-sa", role: "builder", status: "running" });
    rm.sayMode = "live";
    assert.equal(dataOf(await call<SayResult>("POST", "/api/v1/tickets/T-002-sa/say", { text: "add a header row" })).action, "steered");
    const h = dataOf(await call<SayResult>("POST", "/api/v1/tickets/T-004-sa/say", { text: "@fixer look at the rounding" }));
    assert.equal(h.action, "handed-off");
    assert.equal(h.run?.role, "fixer");
    const c = dataOf(await call<SayResult>("POST", "/api/v1/tickets/T-003-sa/say", { text: "waiting on the vendor" }));
    assert.deepEqual(c, { action: "commented" });
    const empty = await call("POST", "/api/v1/tickets/T-003-sa/say", { text: "  " });
    assert.equal(empty.status, 400);
  });
});
