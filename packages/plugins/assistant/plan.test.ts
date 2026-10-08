import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Actor, AssistantEvent, CrewService, HandoffInput, PlanCard, RunManagerService, RunState, TicketsService } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { type FakeRequest, providersToml, sseText, sseToolCalls, startFakeOpenAI } from "../providers/fake-server.ts";
import { catalog } from "../registry.ts";
import { createAssistant, DECIDE_HINT } from "./assistant.ts";
import { buildPlan, parseDecision, planText } from "./plan.ts";
import { collect } from "./testing.ts";

const actor: Actor = { kind: "person", id: "sam", onBehalfOf: "sam" };
const { "approval-queue": _q, ...noQueue } = catalog;

/** A fake crew: two roles per ticket, hand-offs recorded; a ticket listed in `failOn` refuses. */
function fakeCrew(failOn: string[] = []) {
  const handoffs: { input: HandoffInput; actor: Actor; origin?: string }[] = [];
  const runs = new Map<string, RunState>();
  const crew: CrewService = {
    roles: async () => [
      { id: "analyst", label: "Analyst", engine: "claude-code", worktree: false },
      { id: "planner", label: "Planner", engine: "claude-code", worktree: false },
      { id: "builder", label: "Builder", engine: "cursor", worktree: true },
    ],
    next: async () => undefined,
    async handoff(input, a, origin) {
      if (failOn.includes(input.ticket)) throw new Error(`no engine for ${input.ticket}`);
      handoffs.push({ input, actor: a, ...(origin ? { origin } : {}) });
      const run: RunState = {
        id: `r-${handoffs.length}`,
        runtime: input.engine ?? "claude-code",
        ticket: input.ticket,
        mode: "ask",
        status: "running",
        started: new Date().toISOString(),
        ...(input.role ? { role: input.role } : {}),
      };
      runs.set(run.id, run);
      return run;
    },
    say: async () => ({ action: "commented" }),
    engines: async () => [
      { id: "claude-code", label: "Claude Code", capabilities: { resume: true, steer: false, approve: true, models: true }, test: { ok: true, checks: [] } },
      {
        id: "cursor",
        label: "Cursor",
        capabilities: { resume: true, steer: false, approve: false, models: true },
        test: { ok: false, checks: [{ level: "error", message: "not signed in" }] },
      },
    ],
  };
  const runManager = {
    get: (id: string) => runs.get(id),
    active: () => [...runs.values()].filter((r) => r.status === "running"),
    list: async () => [...runs.values()],
  } as unknown as RunManagerService;
  return { crew, runManager, handoffs, runs };
}

const tickets = {
  async get(id: string) {
    if (!["T-014-sa", "T-016-sa"].includes(id)) throw Object.assign(new Error(`no ticket ${id}`), { rule: "unknown-ticket" });
    return { id };
  },
} as unknown as TicketsService;

const STEPS = [
  { ticket: "T-016-sa", role: "analyst", task: "Write the spec", done_check: "spec frozen" },
  { ticket: "T-016-sa", role: "planner", task: "Write the plan", done_check: "plan has slices" },
  { ticket: "T-014-sa", role: "builder", engine: "cursor", task: "Build slice 1", done_check: "slice 1 tests pass" },
];

test("propose_plan validation: unknown ticket, role or engine refused; no crew explained", async () => {
  const f = fakeCrew();
  const deps = { crew: () => f.crew, tickets: () => tickets, runs: () => f.runManager };
  const good = await buildPlan({ title: "Spec, plan and build", steps: STEPS }, deps);
  assert.ok(good.ok);
  assert.equal(good.card.status, "proposed");
  assert.match(good.card.id, /^pl-/);
  assert.deepEqual(
    good.card.steps.map((s) => [s.ticket, s.role, s.engine, s.status]),
    [
      ["T-016-sa", "analyst", undefined, "proposed"],
      ["T-016-sa", "planner", undefined, "proposed"],
      ["T-014-sa", "builder", "cursor", "proposed"],
    ],
  );
  const badTicket = await buildPlan({ title: "x", steps: [{ ...STEPS[0], ticket: "T-999-zz" }] }, deps);
  assert.ok(!badTicket.ok && /no ticket T-999-zz/.test(badTicket.error));
  const badRole = await buildPlan({ title: "x", steps: [{ ...STEPS[0], role: "wizard" }] }, deps);
  assert.ok(!badRole.ok && /no role "wizard".*analyst, planner, builder/.test(badRole.error));
  const badEngine = await buildPlan({ title: "x", steps: [{ ...STEPS[0], engine: "vim" }] }, deps);
  assert.ok(!badEngine.ok && /no engine "vim"/.test(badEngine.error));
  const noCheck = await buildPlan({ title: "x", steps: [{ ...STEPS[0], done_check: "" }] }, deps);
  assert.ok(!noCheck.ok && /done_check/.test(noCheck.error));
  const empty = await buildPlan({ title: "x", steps: [] }, deps);
  assert.ok(!empty.ok);
  const noCrew = await buildPlan({ title: "x", steps: STEPS }, { ...deps, crew: () => undefined });
  assert.ok(!noCrew.ok && /crew plugin is not enabled/.test(noCrew.error));
});

test("parseDecision checks indexes and values", () => {
  assert.deepEqual(parseDecision({ decisions: { "0": "approve", "1": "skip" } }), { decisions: { "0": "approve", "1": "skip" } });
  assert.deepEqual(parseDecision({ revise: " smaller " }), { decisions: {}, revise: "smaller" });
  assert.throws(() => parseDecision({ decisions: { a: "approve" } }), /step index/);
  assert.throws(() => parseDecision({ decisions: { "0": "go" } }), /approve" or "skip/);
  assert.throws(() => parseDecision({}), /nothing to decide/);
});

/** A model that observes (crew_status), proposes a bad plan, fixes it, and would answer on if not stopped. */
function routingModel(req: FakeRequest, n: number) {
  const msgs = req.body.messages as { role: string; content: string | null }[];
  const last = msgs.at(-1);
  if (last?.role === "user") return { sse: sseToolCalls([{ id: "c1", name: "crew_status", args: "{}" }]) };
  if (last?.content?.includes('name="crew_status"'))
    return { sse: sseToolCalls([{ id: "c2", name: "propose_plan", args: JSON.stringify({ title: "Bad", steps: [{ ...STEPS[0], ticket: "T-404-xx" }] }) }]) };
  if (last?.content?.includes("no ticket T-404-xx"))
    return { sse: sseToolCalls([{ id: "c3", name: "propose_plan", args: JSON.stringify({ title: "Spec and plan T-016", steps: STEPS.slice(0, 2) }) }]) };
  return { sse: sseText([`unexpected call ${n}`]) };
}

test("assistant: propose_plan stores the card on an assistant message and ends the turn", async () => {
  const fake = await startFakeOpenAI(routingModel);
  const ws = await createTestWorkspace({ catalog: noQueue });
  appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
  await ws.runtime.mountAll();
  const f = fakeCrew();
  try {
    const a = createAssistant(ws.runtime.ctx, { services: { crew: f.crew, runManager: f.runManager, tickets } });
    const chat = await a.create({ channel: "console" });
    const ev = await collect(a.send(chat.id, "spec and plan T-016", { actor, channel: "console" }));
    assert.equal(fake.requests.length, 3, "the turn ends after the card: no fourth model call");
    const tools = ev.filter((e): e is Extract<AssistantEvent, { type: "message" }> => e.type === "message" && e.message.role === "tool");
    assert.deepEqual(
      tools.map((t) => [t.message.tool?.name, t.message.tool?.status]),
      [
        ["crew_status", "done"],
        ["propose_plan", "failed"],
        ["propose_plan", "done"],
      ],
    );
    assert.match(tools[0]?.message.tool?.result ?? "", /"problem":"not signed in"/);
    const cardEv = ev.filter((e) => e.type === "message").at(-1) as Extract<AssistantEvent, { type: "message" }>;
    const plan = cardEv.message.plan as PlanCard;
    assert.equal(plan.title, "Spec and plan T-016");
    assert.equal(plan.steps.length, 2);
    assert.ok(cardEv.message.text.endsWith(DECIDE_HINT), "Telegram shows the card as text with a pointer to the console");
    assert.equal(ev.at(-1)?.type, "done");
    assert.equal(f.handoffs.length, 0, "nothing starts without the card");

    // The card is in the chat JSONL.
    const lines = readFileSync(join(ws.root, "chats", `${chat.id}.jsonl`), "utf8")
      .trim()
      .split("\n");
    assert.ok(lines.some((l) => (JSON.parse(l) as { m?: { plan?: PlanCard } }).m?.plan?.id === plan.id));

    // Deciding: the first step on the ticket starts, the second waits for it.
    const decided = await a.plans.decide(chat.id, plan.id, { decisions: { "0": "approve", "1": "approve" } }, actor);
    assert.deepEqual(
      decided.steps.map((s) => s.status),
      ["started", "approved"],
    );
    assert.equal(decided.status, "decided");
    assert.equal(f.handoffs[0]?.input.message, "Write the spec\nDONE when: spec frozen");
    assert.equal(f.handoffs[0]?.origin, `assistant:${chat.id}`);
    const reloaded = (await a.get(chat.id)).messages.find((m) => m.plan?.id === plan.id)?.plan;
    assert.deepEqual(reloaded, decided, "the stored card is the decided one");
    assert.match(planText(decided), /✔ 1\. T-016-sa analyst: Write the spec/);
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

async function withPlan(steps: typeof STEPS, failOn: string[] = []) {
  const ws = await createTestWorkspace({ catalog: noQueue });
  await ws.runtime.mountAll();
  const f = fakeCrew(failOn);
  const a = createAssistant(ws.runtime.ctx, { services: { crew: f.crew, runManager: f.runManager, tickets } });
  const chat = await a.create({ channel: "console", model: "" });
  const built = await buildPlan({ title: "Plan", steps }, { crew: () => f.crew, tickets: () => tickets, runs: () => f.runManager });
  assert.ok(built.ok);
  await a.store.append(chat.id, { t: "msg", m: { id: "m-card", role: "assistant", text: "card", plan: built.card, ts: new Date().toISOString() } });
  return { ws, f, a, chatId: chat.id, planId: built.card.id };
}

test("decide: sequential per ticket; the next step starts when the run reports done", async () => {
  const { ws, f, a, chatId, planId } = await withPlan(STEPS);
  try {
    const card = await a.plans.decide(chatId, planId, { decisions: { "0": "approve", "1": "approve", "2": "approve" } }, actor);
    assert.deepEqual(
      card.steps.map((s) => [s.status, s.run]),
      [
        ["started", "r-1"],
        ["approved", undefined],
        ["started", "r-2"],
      ],
    );
    assert.deepEqual(
      f.handoffs.map((h) => [h.input.ticket, h.input.role, h.input.engine]),
      [
        ["T-016-sa", "analyst", undefined],
        ["T-014-sa", "builder", "cursor"],
      ],
    );
    // r-1 ends without "done": the next step stays approved for the person.
    Object.assign(f.runs.get("r-1") as RunState, { status: "done", outcome: { outcome: "review", summary: "look" } });
    await a.plans.runFinished("r-1");
    assert.equal(f.handoffs.length, 2);
    // Approving the waiting step again is the Start button.
    const started = await a.plans.decide(chatId, planId, { decisions: { "1": "approve" } }, actor);
    assert.equal(started.steps[1]?.status, "started");
    assert.equal(f.handoffs.length, 3);
  } finally {
    await ws.cleanup();
  }
});

test("decide: a done outcome chains the next step on the ticket through run.finished", async () => {
  const { ws, f, a, chatId, planId } = await withPlan(STEPS.slice(0, 2));
  try {
    await a.plans.decide(chatId, planId, { decisions: { "0": "approve", "1": "approve" } }, actor);
    assert.equal(f.handoffs.length, 1);
    Object.assign(f.runs.get("r-1") as RunState, { status: "done", outcome: { outcome: "done", summary: "spec frozen" } });
    await a.plans.runFinished("r-1");
    assert.deepEqual(
      f.handoffs.map((h) => h.input.role),
      ["analyst", "planner"],
    );
    const stored = (await a.get(chatId)).messages.find((m) => m.plan)?.plan;
    assert.deepEqual(
      stored?.steps.map((s) => [s.status, s.run]),
      [
        ["started", "r-1"],
        ["started", "r-2"],
      ],
    );
  } finally {
    await ws.cleanup();
  }
});

test("decide: skip, revise and failed hand-offs", async () => {
  const { ws, f, a, chatId, planId } = await withPlan(STEPS, ["T-014-sa"]);
  try {
    const one = await a.plans.decide(chatId, planId, { decisions: { "0": "skip", "2": "approve" } }, actor);
    assert.deepEqual(
      one.steps.map((s) => s.status),
      ["skipped", "proposed", "failed"],
    );
    assert.match(one.steps[2]?.error ?? "", /no engine for T-014-sa/);
    assert.equal(one.status, "proposed");
    // Revise: what is still proposed is skipped (the new card replaces it).
    const two = await a.plans.decide(chatId, planId, { decisions: {}, revise: "only the plan" }, actor);
    assert.deepEqual(
      two.steps.map((s) => s.status),
      ["skipped", "skipped", "failed"],
    );
    assert.equal(two.status, "decided");
    assert.equal(f.handoffs.length, 0);
    await assert.rejects(a.plans.decide(chatId, planId, { decisions: { "9": "approve" } }, actor), /no step 9/);
    await assert.rejects(a.plans.decide(chatId, "pl-nope", { decisions: { "0": "skip" } }, actor), /has no plan pl-nope/);
  } finally {
    await ws.cleanup();
  }
});
