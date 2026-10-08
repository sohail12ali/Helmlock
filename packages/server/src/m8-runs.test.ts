// Milestone 8 run routes: GET /runs filters, POST /runs/:id/say, diff and merge refusals, POST /sessions/reset and the
// internal POST /hooks/run-report. The Claude adapter runs the fake agent CLI (test/fixtures/s5-fake) in a live session.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type ApiResponse, type RunDetail, type RunSayResult, type RunState, WRITE_HEADER } from "@helmlock/core";
import { createTestWorkspace, FIXTURES, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

const FAKE = join(FIXTURES, "s5-fake", process.platform === "win32" ? "fake-agent.cmd" : "fake-agent");
const TOKEN = "t0k-m8";
let ws: TestWorkspace;
let app: Hono;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
const W = { "content-type": "application/json", [WRITE_HEADER]: "1" };
const H = { "content-type": "application/json", "X-Helmlock-Hook-Token": TOKEN };
async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = W) {
  const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as ApiResponse<T> };
}
const dataOf = <T>(r: { body: ApiResponse<T> }) => (r.body as { ok: true; data: T }).data;
const errOf = (r: { body: ApiResponse<unknown> }) => (r.body as { ok: false; error: { rule: string } }).error;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  setEnv("HL_CLAUDE_BIN", FAKE);
  setEnv("FAKE_MODE", "hang");
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  app = createApp(ws.runtime, { log: () => {}, hookToken: TOKEN, heartbeatMs: 1000 });
});
after(async () => {
  await ws.cleanup();
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
});

test("POST /runs takes any engine id; an unknown one is 422, a malformed one 400", async () => {
  assert.equal((await call("POST", "/api/v1/runs", { task: "x", runtime: "no-such-engine" })).status, 422);
  assert.equal((await call("POST", "/api/v1/runs", { task: "x", runtime: "Bad Id" })).status, 400);
});

test("a live run: say steers it, run-report records the outcome, GET /runs filters; diff and merge refuse without a worktree", async () => {
  const started = await call<RunDetail>("POST", "/api/v1/runs", { task: "keep going", ticket: "T-001-sa", mode: "ask" });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const run = dataOf(started);
  assert.equal(run.capabilities?.steer, true);
  await wait(300);

  assert.equal((await call("POST", `/api/v1/runs/${run.id}/say`, { text: "x" }, { "content-type": "application/json" })).status, 403);
  assert.equal((await call("POST", `/api/v1/runs/${run.id}/say`, { text: "" })).status, 400);
  const said = await call<RunSayResult>("POST", `/api/v1/runs/${run.id}/say`, { text: "also check the docs" });
  assert.equal(said.status, 200, JSON.stringify(said.body));
  assert.deepEqual(dataOf(said), { delivered: "live" });

  const report = { run_id: run.id, outcome: "review", summary: "Ready for a look", next: "verify", next_role: "verifier" };
  assert.equal((await call("POST", "/api/v1/hooks/run-report", report, { "content-type": "application/json" })).status, 403);
  assert.equal((await call("POST", "/api/v1/hooks/run-report", { ...report, run_id: "run-nope" }, H)).status, 404);
  assert.equal((await call("POST", "/api/v1/hooks/run-report", { ...report, outcome: "finished" }, H)).status, 400);
  const rep = await call<RunDetail>("POST", "/api/v1/hooks/run-report", report, H);
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  assert.deepEqual(dataOf(rep).outcome, { outcome: "review", summary: "Ready for a look", next: "verify", next_role: "verifier" });
  assert.deepEqual(dataOf(await call<RunDetail>("GET", `/api/v1/runs/${run.id}`)).outcome, dataOf(rep).outcome);

  const listed = dataOf(await call<RunState[]>("GET", "/api/v1/runs?ticket=T-001-sa"));
  assert.ok(listed.some((r) => r.id === run.id && r.status === "running"));
  assert.equal(dataOf(await call<RunState[]>("GET", "/api/v1/runs?ticket=T-999-sa")).length, 0);
  assert.equal((await call("GET", "/api/v1/runs?limit=x")).status, 400);

  const diff = await call("GET", `/api/v1/runs/${run.id}/diff`);
  assert.equal(diff.status, 409);
  assert.equal(errOf(diff).rule, "no-worktree");
  assert.equal((await call("POST", `/api/v1/runs/${run.id}/merge`, {})).status, 409);

  await call("POST", `/api/v1/runs/${run.id}/cancel`, {});
  for (let i = 0; i < 200 && dataOf(await call<RunDetail>("GET", `/api/v1/runs/${run.id}`)).status === "running"; i++) await wait(50);
  const ended = dataOf(await call<(RunState & { ok?: boolean })[]>("GET", "/api/v1/runs?ticket=T-001-sa&limit=1"))[0];
  assert.equal(ended?.id, run.id);
  assert.equal(ended?.ok, false, "rows keep RunSummary's ok for the older views");
  assert.equal(ended?.status, "cancelled");
});

test("POST /sessions/reset: 204, write-protected, validated", async () => {
  assert.equal((await call("POST", "/api/v1/sessions/reset", { role: "builder", ticket: "T-001-sa" }, { "content-type": "application/json" })).status, 403);
  assert.equal((await call("POST", "/api/v1/sessions/reset", { role: "Builder!", ticket: "T-001-sa" })).status, 400);
  const res = await app.request("/api/v1/sessions/reset", { method: "POST", headers: W, body: JSON.stringify({ role: "builder", ticket: "T-001-sa" }) });
  assert.equal(res.status, 204);
});
