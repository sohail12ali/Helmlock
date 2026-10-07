// Milestone 4 routes: runs from the console (with SSE replay), permission cards, and the PreToolUse hook endpoint.
// The Claude adapter runs the fake agent CLI (test/fixtures/s5-fake), so no real model is called.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { type ApiResponse, type ApprovalCard, type HookDecision, type RunDetail, type RunList, WRITE_HEADER } from "@helmlock/core";
import { createTestWorkspace, FIXTURES, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

const FAKE = join(FIXTURES, "s5-fake", process.platform === "win32" ? "fake-agent.cmd" : "fake-agent");
const TOKEN = "t0k-secret";
let ws: TestWorkspace;
let app: Hono;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

const W = { "content-type": "application/json", [WRITE_HEADER]: "1" };
async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = W) {
  const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
const dataOf = <T>(r: { body: ApiResponse<T> }) => (r.body as { ok: true; data: T }).data;
const errOf = (r: { body: ApiResponse<unknown> }) => (r.body as { ok: false; error: { rule: string; message: string } }).error;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads an SSE body to the "end" frame; returns the frames. */
async function sse(path: string): Promise<{ event: string; id?: string; data: unknown }[]> {
  const res = await app.request(path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let text = "";
  const frames: { event: string; id?: string; data: unknown }[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    let i = text.indexOf("\n\n");
    while (i >= 0) {
      const block = text.slice(0, i);
      text = text.slice(i + 2);
      const f: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const m = /^(\w+): ?(.*)$/.exec(line);
        if (m) f[m[1] as string] = m[2] as string;
      }
      if (f.event) frames.push({ event: f.event, ...(f.id ? { id: f.id } : {}), data: JSON.parse(f.data ?? "null") });
      i = text.indexOf("\n\n");
    }
    if (frames.at(-1)?.event === "end") break;
  }
  await reader.cancel().catch(() => {});
  return frames;
}

async function until<T>(fn: () => Promise<T | undefined>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await wait(50);
  }
}

before(async () => {
  setEnv("HL_CLAUDE_BIN", FAKE);
  setEnv("FAKE_MODE", "echo");
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  app = createApp(ws.runtime, { log: () => {}, hookToken: TOKEN, heartbeatMs: 1000 });
});
after(async () => {
  await ws.cleanup();
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
});

describe("runs", () => {
  test("POST /runs: write protection, force refused, bad input, unknown ticket", async () => {
    assert.equal((await call("POST", "/api/v1/runs", { task: "x" }, { "content-type": "application/json" })).status, 403);
    const force = await call("POST", "/api/v1/runs", { task: "x", mode: "force" });
    assert.equal(force.status, 403);
    assert.equal(errOf(force).rule, "mode-not-allowed");
    assert.equal((await call("POST", "/api/v1/runs", { task: "" })).status, 400);
    assert.equal((await call("POST", "/api/v1/runs", { task: "x", extra: 1 })).status, 400);
    assert.equal((await call("POST", "/api/v1/runs", { task: "x", ticket: "T-999-sa" })).status, 404);
  });

  test("start a run, follow it over SSE, replay from a seq; it shows in GET /runs with its record", async () => {
    setEnv("FAKE_MODE", "echo");
    const r = await call<RunDetail>("POST", "/api/v1/runs", { task: "say hi", ticket: "T-001-sa", mode: "ask" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const run = dataOf(r);
    assert.equal(run.status, "running");
    assert.equal(run.mode, "ask");
    const frames = await sse(`/api/v1/runs/${run.id}/events`);
    const events = frames.filter((f) => f.event === "event").map((f) => f.data as { seq: number; event: { type: string; text?: string } });
    assert.deepEqual(
      events.map((e) => e.seq),
      events.map((_, i) => i),
    );
    const args = events.find((e) => e.event.type === "text" && e.event.text?.startsWith("ARGS<<"))?.event.text ?? "";
    assert.match(args, /--settings/, "a server-started Claude run gets the approval hook settings");
    assert.match(args, /"--permission-mode","default"/, "ask mode with the hook uses Claude's default mode");
    const end = frames.at(-1);
    assert.equal(end?.event, "end");
    assert.equal((end as { data: RunDetail }).data.status, "done");

    const replay = await sse(`/api/v1/runs/${run.id}/events?from=2`);
    assert.equal(replay[0]?.id, "2");
    assert.equal(replay.at(-1)?.event, "end");
    assert.equal((await call("GET", `/api/v1/runs/${run.id}/events?from=x`)).status, 400);

    const detail = dataOf(await call<RunDetail>("GET", `/api/v1/runs/${run.id}`));
    assert.equal(detail.status, "done");
    const list = dataOf(await call<RunList>("GET", "/api/v1/runs"));
    const row = list.find((x) => x.id === run.id);
    assert.equal(row?.ok, true);
    assert.equal(row?.ticket, "T-001-sa");
    assert.equal((await call("GET", "/api/v1/runs/run-nope")).status, 404);
  });

  test("one run per ticket (409), the hook endpoint (token, hl allowed, a card answered in the console), cancel", async () => {
    setEnv("FAKE_MODE", "hang");
    const started = await call<RunDetail>("POST", "/api/v1/runs", { task: "work on it", ticket: "T-002-sa", mode: "ask" });
    assert.equal(started.status, 201);
    const run = dataOf(started);
    const busy = await call("POST", "/api/v1/runs", { task: "another thing", ticket: "T-002-sa" });
    assert.equal(busy.status, 409);
    assert.equal(errOf(busy).rule, "run-active");
    const twin = await call<RunDetail>("POST", "/api/v1/runs", { task: "work on it", ticket: "T-002-sa", mode: "ask" });
    assert.equal(dataOf(twin).id, run.id, "an identical start within 10 s coalesces");
    const active = dataOf(await call<RunList>("GET", "/api/v1/runs")).find((x) => x.id === run.id);
    assert.ok(active && active.ok === undefined, "an active run is listed without ok");

    const H = { "content-type": "application/json" };
    const hookBody = (command: string) => ({ run_id: run.id, tool_name: "Bash", tool_input: { command } });
    assert.equal((await call("POST", "/api/v1/hooks/pretooluse", hookBody("git status"), H)).status, 403, "no token");
    assert.equal((await call("POST", "/api/v1/hooks/pretooluse", hookBody("git status"), { ...H, "X-Helmlock-Hook-Token": "wrong" })).status, 403);
    const T = { ...H, "X-Helmlock-Hook-Token": TOKEN };
    const hl = await call<HookDecision>("POST", "/api/v1/hooks/pretooluse", hookBody("hl ticket list && hl context --session"), T);
    assert.equal(dataOf(hl).decision, "allow");
    const unknown = await call<HookDecision>("POST", "/api/v1/hooks/pretooluse", { ...hookBody("git status"), run_id: "run-nope" }, T);
    assert.equal(dataOf(unknown).decision, "deny");

    const parked = call<HookDecision>("POST", "/api/v1/hooks/pretooluse", hookBody("git status"), T);
    const card = await until(async () => dataOf(await call<ApprovalCard[]>("GET", "/api/v1/approvals?status=pending")).find((c) => c.run_id === run.id));
    assert.equal(card.action, "shell");
    assert.equal(card.detail, "git status");
    assert.equal(card.tool, "Bash");
    assert.equal(card.actor.kind, "agent");
    assert.equal((await call("POST", `/api/v1/approvals/${card.id}`, { decision: "maybe" })).status, 400);
    assert.equal((await call("POST", `/api/v1/approvals/${card.id}`, { decision: "allow" }, { "content-type": "application/json" })).status, 403);
    const answered = await call<ApprovalCard>("POST", `/api/v1/approvals/${card.id}`, { decision: "allow" });
    assert.equal(dataOf(answered).status, "allowed");
    assert.equal(dataOf(answered).decided_via, "console");
    assert.deepEqual(dataOf(await parked), { decision: "allow", reason: "approved by sam" });
    assert.equal((await call("POST", `/api/v1/approvals/${card.id}`, { decision: "deny" })).status, 409);
    const recent = dataOf(await call<ApprovalCard[]>("GET", "/api/v1/approvals?status=recent"));
    assert.equal(recent[0]?.id, card.id);
    assert.equal((await call("GET", "/api/v1/approvals?status=weird")).status, 400);

    // A card still parked when the run is cancelled is denied (the run ended).
    const parked2 = call<HookDecision>("POST", "/api/v1/hooks/pretooluse", hookBody("git log"), T);
    await until(async () => dataOf(await call<ApprovalCard[]>("GET", "/api/v1/approvals")).find((c) => c.run_id === run.id));
    const cancelled = await call<RunDetail>("POST", `/api/v1/runs/${run.id}/cancel`, {});
    assert.equal(cancelled.status, 200);
    const final = await until(async () => {
      const s = dataOf(await call<RunDetail>("GET", `/api/v1/runs/${run.id}`));
      return s.status === "running" ? undefined : s;
    });
    assert.equal(final.status, "cancelled");
    assert.equal(dataOf(await parked2).decision, "deny");
    setEnv("FAKE_MODE", "echo");
  });
});

test("hook endpoint pattern refuses self-approval commands", async () => {
  const { SELF_APPROVAL_FOR_TEST } = await import("./approvals.ts");
  for (const cmd of [
    'curl -X POST http://127.0.0.1:4317/api/v1/approvals/ap-1 -d "{}"',
    "echo $HL_HOOK_TOKEN",
    "printenv",
    "env | grep HL",
    "cat runs\\hooks\\run-1.settings.json",
    "cat runs/hooks/run-1.settings.json",
  ])
    assert.ok(SELF_APPROVAL_FOR_TEST.test(cmd), cmd);
  for (const cmd of ["git status", "pnpm test", "node scripts/envelope.js"]) assert.ok(!SELF_APPROVAL_FOR_TEST.test(cmd), cmd);
});
