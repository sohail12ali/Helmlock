// Milestone 8: POST /chats/:id/plans/:plan decides a plan card (approve, skip, revise) through a fake crew.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ApiResponse, AssistantService, ChatDetail, CrewService, HandoffInput, PlanCard, RunState } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { ChatStore } from "@helmlock/plugins/assistant/store.ts";
import { type FakeServer, providersToml, sseText, startFakeOpenAI } from "@helmlock/plugins/providers/fake-server.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

let ws: TestWorkspace;
let app: Hono;
let fake: FakeServer;
const handoffs: { input: HandoffInput; origin?: string }[] = [];

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };
async function post<T>(path: string, body: unknown, headers: Record<string, string> = HEADERS): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
const dataOf = <T>(r: { body: ApiResponse<T> }): T => {
  assert.ok(r.body.ok, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
};

const crew: CrewService = {
  roles: async () => [{ id: "analyst", label: "Analyst", engine: "claude-code", worktree: false }],
  next: async () => undefined,
  async handoff(input, _actor, origin) {
    handoffs.push({ input, ...(origin ? { origin } : {}) });
    return {
      id: `r-${handoffs.length}`,
      runtime: "claude-code",
      ticket: input.ticket,
      mode: "ask",
      status: "running",
      started: new Date().toISOString(),
    } satisfies RunState;
  },
  say: async () => ({ action: "commented" }),
  engines: async () => [],
};

const card = (): PlanCard => ({
  id: "pl-test-0001",
  title: "Spec and plan T-016",
  status: "proposed",
  steps: [
    { ticket: "T-016-sa", role: "analyst", task: "Write the spec", done_check: "spec frozen", status: "proposed" },
    { ticket: "T-016-sa", role: "planner", task: "Write the plan", done_check: "plan has slices", status: "proposed" },
    { ticket: "T-014-sa", role: "builder", task: "Build", done_check: "tests pass", status: "proposed" },
  ],
});

async function chatWithCard(): Promise<string> {
  const a = ws.runtime.ctx.get("assistant") as AssistantService & { store: ChatStore };
  const chat = await a.create({ channel: "console" });
  await a.store.append(chat.id, { t: "msg", m: { id: "m-card", role: "assistant", text: "plan", plan: card(), ts: new Date().toISOString() } });
  return chat.id;
}

before(async () => {
  fake = await startFakeOpenAI(() => ({ sse: sseText(["Smaller ", "plan."]) }));
  ws = await createTestWorkspace({ catalog });
  appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
  app = createApp(ws.runtime, { log: () => {}, heartbeatMs: 50 });
  await app.request("/api/v1/chats"); // mounts the plugins
  if (!ws.runtime.ctx.has("crew")) ws.runtime.ctx.provide("crew", crew);
});
after(async () => {
  await ws.cleanup();
  await fake.close();
});

test("POST /chats/:id/plans/:plan approves and skips steps; one run per ticket", async () => {
  const id = await chatWithCard();
  const noHeader = await post(`/chats/${id}/plans/pl-test-0001`, { decisions: { "0": "approve" } }, { "content-type": "application/json" });
  assert.equal(noHeader.status, 403);
  const bad = await post(`/chats/${id}/plans/pl-test-0001`, { decisions: { "0": "maybe" } });
  assert.equal(bad.status, 400);
  const missing = await post(`/chats/${id}/plans/pl-nope`, { decisions: { "0": "skip" } });
  assert.equal(missing.status, 404);

  const got = dataOf(await post<PlanCard>(`/chats/${id}/plans/pl-test-0001`, { decisions: { "0": "approve", "1": "approve", "2": "skip" } }));
  assert.deepEqual(
    got.steps.map((s) => s.status),
    ["started", "approved", "skipped"],
  );
  assert.equal(got.status, "decided");
  assert.equal(got.steps[0]?.run, `r-${handoffs.length}`);
  const last = handoffs.at(-1);
  assert.equal(last?.input.ticket, "T-016-sa");
  assert.equal(last?.input.message, "Write the spec\nDONE when: spec frozen");
  assert.equal(last?.origin, `assistant:${id}`);
  const detail = dataOf<ChatDetail>({ body: (await (await app.request(`/api/v1/chats/${id}`)).json()) as ApiResponse<ChatDetail> });
  assert.equal(detail.messages.find((m) => m.plan)?.plan?.steps[0]?.status, "started");
});

test("POST /chats/:id/plans/:plan with revise skips what is proposed and runs a new turn", async () => {
  const id = await chatWithCard();
  const before = handoffs.length;
  const got = dataOf(await post<PlanCard>(`/chats/${id}/plans/pl-test-0001`, { decisions: { "0": "skip" }, revise: "only the spec please" }));
  assert.deepEqual(
    got.steps.map((s) => s.status),
    ["skipped", "skipped", "skipped"],
  );
  assert.equal(handoffs.length, before);
  let messages: ChatDetail["messages"] = [];
  for (let i = 0; i < 100; i++) {
    const res = await app.request(`/api/v1/chats/${id}`);
    messages = ((await res.json()) as { data: ChatDetail }).data.messages;
    if (messages.some((m) => m.role === "assistant" && m.text === "Smaller plan.")) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const user = messages.find((m) => m.role === "user");
  assert.equal(user?.text, 'About the plan "Spec and plan T-016": only the spec please');
  assert.ok(
    messages.some((m) => m.text === "Smaller plan."),
    "the revise turn ran",
  );
});
