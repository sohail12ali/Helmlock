import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Actor, AssistantEvent, AssistantService, ChatTurn } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { type FakeRequest, providersToml, sseText, sseToolCalls, startFakeOpenAI } from "../providers/fake-server.ts";
import { catalog } from "../registry.ts";
import { createAssistant } from "./assistant.ts";
import { collect, fakeQueue } from "./testing.ts";
import { buildTools, hlCommand, readFileTool } from "./tools.ts";
import { estimateTokens, fitWindow } from "./window.ts";

const actor: Actor = { kind: "person", id: "sam", onBehalfOf: "sam" };

type Msg = { role: string; content: string | null; tool_calls?: unknown[] };
const msgs = (r: FakeRequest) => r.body.messages as Msg[];
const lastUser = (r: FakeRequest) => [...msgs(r)].reverse().find((m) => m.role === "user")?.content ?? "";

/** A scripted model: tool calls for some prompts, text answers after a tool result. */
function scripted(req: FakeRequest) {
  const last = msgs(req).at(-1);
  const u = lastUser(req);
  if (last?.role === "tool") return { sse: sseText([u.includes("todo") ? "Added " : "Nothing ", "found."]) };
  if (u.includes("find")) return { sse: sseToolCalls([{ id: "call_s", name: "search", args: '{"query":"uat"}' }]) };
  if (u.includes("todo")) return { sse: sseToolCalls([{ id: "call_t", name: "todo_add", args: '{"text":"Ask ops for the UAT login"}' }]) };
  return { sse: sseText(["Hello ", "Sam."]) };
}

/** These tests supply their own approval queue (fakeQueue), so the real approval-queue plugin is left out. */
const { "approval-queue": _realQueue, ...catalogWithoutQueue } = catalog;

async function setup() {
  const fake = await startFakeOpenAI(scripted);
  const ws = await createTestWorkspace({ catalog: catalogWithoutQueue });
  appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
  await ws.runtime.mountAll();
  return { fake, ws, a: ws.runtime.ctx.get("assistant") as AssistantService };
}

test("assistant: plain answer, read tool, persisted history, resume after restart", async () => {
  const { fake, ws, a } = await setup();
  try {
    const chat = await a.create({ channel: "console" });
    assert.equal(chat.model, "fake/m1");
    assert.equal(chat.title, "New chat");
    const ev = await collect(a.send(chat.id, "hi there", { actor, channel: "console" }));
    assert.deepEqual(
      ev.map((e) => e.type),
      ["message", "delta", "delta", "message", "done"],
    );
    const reply = ev[3] as Extract<AssistantEvent, { type: "message" }>;
    assert.equal(reply.message.text, "Hello Sam.");
    assert.deepEqual(reply.message.usage, { input_tokens: 12, output_tokens: 5 });
    const sys = msgs(fake.requests[0] as FakeRequest)[0] as Msg;
    assert.equal(sys.role, "system");
    assert.match(sys.content ?? "", /Lead with the answer/, "house style from the delivery repo");
    assert.ok(
      ((fake.requests[0] as FakeRequest).body.tools as { function: { name: string } }[]).some((t) => t.function.name === "todo_add") === false,
      "no queue: no write tools",
    );

    const ev2 = await collect(a.send(chat.id, "find the uat ticket", { actor, channel: "console" }));
    const tool = ev2.find((e) => e.type === "message" && e.message.role === "tool") as Extract<AssistantEvent, { type: "message" }>;
    assert.equal(tool.message.tool?.name, "search");
    assert.equal(tool.message.tool?.status, "done");
    const after = fake.requests.at(-1) as FakeRequest;
    assert.equal(msgs(after).at(-1)?.role, "tool");
    assert.match(msgs(after).at(-1)?.content ?? "", /^<tool_result name="search">/);
    assert.equal(ev2.at(-1)?.type, "done");

    // A fresh assistant (as after a restart) reads the same history and sends it back to the model.
    const again = createAssistant(ws.runtime.ctx);
    const got = await again.get(chat.id);
    assert.equal(got.summary.title, "hi there");
    assert.deepEqual(
      got.messages.map((m) => m.role),
      ["user", "assistant", "user", "assistant", "tool", "assistant"],
    );
    await collect(again.send(chat.id, "hello again", { actor, channel: "console" }));
    const resumed = msgs(fake.requests.at(-1) as FakeRequest).map((m) => m.role);
    assert.deepEqual(resumed, ["system", "user", "assistant", "user", "assistant", "tool", "assistant", "user"]);
    assert.equal((await a.list())[0]?.id, chat.id);
    const lines = readFileSync(join(ws.root, "chats", `${chat.id}.jsonl`), "utf8")
      .trim()
      .split("\n");
    assert.ok(lines.length >= 8);
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("assistant: a write tool waits for approval; allow runs the verb, deny does not", async () => {
  const { fake, ws, a } = await setup();
  try {
    const q = fakeQueue("allow");
    ws.runtime.ctx.provide("approvalQueue", q);
    const chat = await a.create({ channel: "console" });
    const ev = await collect(a.send(chat.id, "add a todo to ask ops", { actor, channel: "console" }));
    const approval = ev.find((e) => e.type === "approval") as Extract<AssistantEvent, { type: "approval" }>;
    assert.ok(approval, "the pending card is streamed");
    assert.equal(approval.card.action, "verb todo add");
    assert.equal(approval.card.detail, 'hl todo add "Ask ops for the UAT login"');
    assert.equal(approval.card.chat_id, chat.id);
    assert.equal(approval.card.local_only, false);
    const statuses = ev
      .filter((e) => e.type === "message" && e.message.role === "tool")
      .map((e) => (e as Extract<AssistantEvent, { type: "message" }>).message.tool?.status);
    assert.deepEqual(statuses, ["proposed", "approved", "done"]);
    const todos = await ws.runtime.ctx.get("todos").list();
    assert.deepEqual(
      todos.map((t) => t.text),
      ["Ask ops for the UAT login"],
    );
    // The activity line names the assistant acting for the person.
    const activity = await ws.runtime.ctx.get("activity").read(new Date().toISOString().slice(0, 10));
    assert.ok(activity.some((l) => l.verb === "todo add" && l.actor.id === "assistant" && l.on_behalf_of === "sam"));
    assert.ok(((fake.requests[0] as FakeRequest).body.tools as { function: { name: string } }[]).some((t) => t.function.name === "todo_add"));

    // Deny: the same queue now says no.
    const denyChat = await a.create({ channel: "telegram" });
    q.decision = "deny";
    const ev2 = await collect(a.send(denyChat.id, "add a todo please", { actor, channel: "telegram" }));
    const denied = ev2
      .filter((e) => e.type === "message" && e.message.role === "tool")
      .map((e) => (e as Extract<AssistantEvent, { type: "message" }>).message.tool?.status);
    assert.deepEqual(denied, ["proposed", "denied"]);
    assert.equal((await ws.runtime.ctx.get("todos").list()).length, 1, "denied: not run");
    const last = fake.requests.at(-1) as FakeRequest;
    assert.match(msgs(last).at(-1)?.content ?? "", /denied/);
    assert.match(msgs(last)[0]?.content ?? "", /low trust/i, "telegram gets the low-trust preset");
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("assistant: model without tool calls gets no tools and a note; trimming keeps the newest turn", async () => {
  const { fake, ws, a } = await setup();
  try {
    const chat = await a.create({ channel: "console", model: "fake/plain" });
    const big = "lorem ipsum ".repeat(130); // about 400 tokens each
    const events: AssistantEvent[][] = [];
    for (let i = 0; i < 3; i++) events.push(await collect(a.send(chat.id, `turn ${i} ${big}`, { actor, channel: "console" })));
    assert.equal(
      events[0]?.some((e) => e.type === "notice"),
      false,
      "no notice before trimming",
    );
    const notice = events[2]?.find((e) => e.type === "notice") as Extract<AssistantEvent, { type: "notice" }> | undefined;
    assert.equal(notice?.code, "context-near-limit", "trimming at ~80% raises a notice");
    assert.match(notice?.message ?? "", /older turn\(s\) were left out/);
    const last = fake.requests.at(-1) as FakeRequest;
    assert.equal(last.body.tools, undefined);
    assert.match(msgs(last)[0]?.content ?? "", /cannot call tools/);
    assert.match(msgs(last)[0]?.content ?? "", /older turn\(s\) were left out/);
    const users = msgs(last).filter((m) => m.role === "user");
    assert.ok(users.length < 3, "oldest turns dropped");
    assert.match(users.at(-1)?.content ?? "", /^turn 2/);

    const tooBig = await collect(a.send(chat.id, "x".repeat(20_000), { actor, channel: "console" }));
    const err = tooBig.find((e) => e.type === "error") as Extract<AssistantEvent, { type: "error" }>;
    assert.equal(err.code, "context_exceeded");

    await assert.rejects(a.setModel(chat.id, "nope/x"), /unknown model/);
    assert.equal((await a.setModel(chat.id, "fake/m1")).model, "fake/m1");
    await assert.rejects(a.get("ch-bad"), /not a chat id/);
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("assistant: provider errors become error events with the stable code", async () => {
  const fake = await startFakeOpenAI(() => ({ status: 401, json: { error: { message: "bad key" } } }));
  const ws = await createTestWorkspace({ catalog });
  try {
    appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
    await ws.runtime.mountAll();
    const a = ws.runtime.ctx.get("assistant");
    const chat = await a.create({ channel: "console" });
    const ev = await collect(a.send(chat.id, "hi", { actor, channel: "console" }));
    assert.deepEqual(
      ev.map((e) => e.type),
      ["message", "error", "done"],
    );
    assert.equal((ev[1] as Extract<AssistantEvent, { type: "error" }>).code, "auth");
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("window, command line and file read helpers", async () => {
  const sys: ChatTurn[] = [{ role: "system", content: "s".repeat(400) }];
  const turns: ChatTurn[][] = [0, 1, 2].map((i) => [{ role: "user", content: `${i}${"u".repeat(800)}` }]);
  const all = estimateTokens([...sys, ...turns.flat()]);
  const fit = fitWindow(sys, turns, undefined, all - 10);
  assert.equal(fit.dropped, 1);
  assert.equal(fit.over, false);
  assert.equal(fitWindow(sys, turns, undefined, 50).over, true);

  assert.equal(
    hlCommand("todo add", ["text"], { text: "Ask ops", ticket: "T-014-sa", priority: "high" }),
    'hl todo add "Ask ops" --ticket T-014-sa --priority high',
  );
  assert.equal(hlCommand("ticket block", ["id"], { id: "T-1-sa", by: "ops", draft: true }), "hl ticket block T-1-sa --by ops --draft");

  const ws = await createTestWorkspace({ catalog });
  try {
    const files = ws.runtime.ctx.get("files");
    assert.equal((await readFileTool(files, "workspace.toml", false)).ok, true);
    assert.equal((await readFileTool(files, "workspace.toml", true)).ok, false, "low trust: tickets only");
    assert.equal((await readFileTool(files, "author.local", false)).ok, false);
    assert.equal((await readFileTool(files, "../x", false)).ok, false);
    assert.equal((await readFileTool(files, ".git/config", false)).ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("tools: secret verbs are never offered to the model, even with writes on", async () => {
  const ws = await createTestWorkspace({ catalog: catalogWithoutQueue });
  try {
    await ws.runtime.mountAll();
    const verbs = ws.runtime.ctx.get("verbs");
    assert.ok(verbs.get("secret set"), "the verb exists");
    const names = buildTools(verbs, { writes: true, lowTrust: false }).map((t) => t.spec.name);
    assert.ok(names.includes("todo_add"));
    assert.ok(!names.includes("secret_set") && !names.includes("secret_status"));
  } finally {
    await ws.cleanup();
  }
});
