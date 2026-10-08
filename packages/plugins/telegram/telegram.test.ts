import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ApprovalCardData,
  ApprovalQueueService,
  AssistantEvent,
  AssistantService,
  ChatSummaryData,
  ProvidersService,
  RunManagerService,
  RunState,
} from "@helmlock/core";
import { createRuntime } from "@helmlock/core";
import { createTestWorkspace, DELIVERY_ROOT, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { createBotApi, type TgUpdate } from "./api.ts";
import { type BotOptions, TelegramBot } from "./bot.ts";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.ts";
import { Config, startTelegram, superviseTelegram } from "./index.ts";

const ME = 4242;
const STRANGER = 666;
const dm = (from: number, text: string): Omit<TgUpdate, "update_id"> => ({
  message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, text },
});
const tap = (from: number, data: string, messageId: number, text = ""): Omit<TgUpdate, "update_id"> => ({
  callback_query: { id: `cb-${messageId}`, from: { id: from }, data, message: { message_id: messageId, chat: { id: from, type: "private" }, text } },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The milestone 8 run manager methods the bot does not use. */
const m8Stubs = (run: RunState): Pick<RunManagerService, "list" | "say" | "report" | "resetSession" | "diff" | "merge"> => ({
  list: async () => [run],
  say: async () => "queued",
  report: async () => run,
  resetSession: async () => {},
  diff: async () => ({ files: [], patch: "" }),
  merge: async () => ({ merged: false, message: "not in this test" }),
});

function fakeAssistant(reply = ["Hel", "lo ", "Sam"], notice?: string) {
  const sent: { chat: string; text: string; channel: string; actor: string }[] = [];
  const chats: ChatSummaryData[] = [];
  let n = 0;
  const svc: AssistantService = {
    async list() {
      return chats;
    },
    async create(o) {
      n += 1;
      const c: ChatSummaryData = {
        id: `chat${n}-${"abcdef".repeat(2)}`,
        title: o.title ?? `Chat ${n}`,
        model: o.model ?? "m",
        channel: o.channel,
        created: "2026-10-07T00:00:00Z",
        updated: `2026-10-07T00:00:0${n}Z`,
      };
      chats.push(c);
      return c;
    },
    async get(id) {
      return { summary: chats.find((c) => c.id === id) as ChatSummaryData, messages: [] };
    },
    async setModel(id, model) {
      const c = chats.find((x) => x.id === id) as ChatSummaryData;
      c.model = model;
      return c;
    },
    async *send(chat, text, o): AsyncIterable<AssistantEvent> {
      sent.push({ chat, text, channel: o.channel, actor: o.actor.id });
      if (notice) yield { type: "notice", code: "context-near-limit", message: notice };
      for (const t of reply) {
        await sleep(15);
        if (o.signal?.aborted) return;
        yield { type: "delta", message_id: "m1", text: t };
      }
      yield { type: "message", message: { id: "m1", role: "assistant", text: reply.join(""), ts: "2026-10-07T00:00:00Z" } };
      yield { type: "done", message_id: "m1" };
    },
  };
  return { svc, sent, chats };
}

function fakeQueue(cards: ApprovalCardData[] = []) {
  const answers: { id: string; decision: string; by: string; via: string; scope?: string }[] = [];
  const svc: ApprovalQueueService = {
    request: async () => {
      throw new Error("not used");
    },
    pending: () => cards.filter((c) => c.status === "pending"),
    recent: () => cards,
    answer(id, decision, by, via, scope) {
      const c = cards.find((x) => x.id === id);
      if (!c) throw new Error(`no approval ${id}`);
      if (c.local_only && via === "telegram") throw new Error("this approval needs the console");
      answers.push({ id, decision, by, via, ...(scope ? { scope } : {}) });
      c.status = decision === "allow" ? "allowed" : "denied";
      return c;
    },
  };
  return { svc, answers };
}

const card = (id: string, extra: Partial<ApprovalCardData> = {}): ApprovalCardData => ({
  id,
  action: "git push",
  detail: "push m4 to origin",
  actor: { kind: "agent", id: "builder", onBehalfOf: "sam" },
  local_only: false,
  created: "2026-10-07T00:00:00Z",
  expires: "2026-10-07T00:05:00Z",
  status: "pending",
  ...extra,
});

interface Harness {
  ws: TestWorkspace;
  api: FakeBotApi;
  bot: TelegramBot;
  logs: string[];
  done(): Promise<void>;
}

async function boot(extra: Partial<BotOptions> = {}, notify = true): Promise<Harness> {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  const api = await startFakeBotApi();
  const logs: string[] = [];
  const bot = new TelegramBot({
    api: createBotApi(api.token, api.base),
    runtime: ws.runtime,
    config: { allowed: [ME], notify, model: undefined },
    log: (l) => logs.push(l),
    pollTimeoutSec: 1,
    backoffMs: 20,
    editIntervalMs: 0,
    ...extra,
  }).start();
  return {
    ws,
    api,
    bot,
    logs,
    async done() {
      await bot.stop();
      await api.close();
      await ws.cleanup();
    },
  };
}

const sentTexts = (api: FakeBotApi) => api.callsTo("sendMessage").map((c) => String(c.params.text));

test("allowlist: a stranger gets nothing and leaves one log line", async () => {
  const h = await boot();
  try {
    h.api.push(dm(STRANGER, "/status"), dm(STRANGER, "hello"), dm(ME, "/help"));
    await h.api.waitFor(() => sentTexts(h.api).length >= 1);
    await sleep(50);
    assert.deepEqual(
      h.api.callsTo("sendMessage").map((c) => c.params.chat_id),
      [ME],
    );
    assert.equal(h.logs.filter((l) => l.includes(`user ${STRANGER}`)).length, 2);
    assert.match(sentTexts(h.api)[0] as string, /\/todo/);
  } finally {
    await h.done();
  }
});

test("a text message sends a working message and edits it into the final answer (low trust channel)", async () => {
  const a = fakeAssistant();
  const h = await boot({ services: { assistant: a.svc } });
  try {
    h.api.push(dm(ME, "say hello"));
    await h.api.waitFor((c) => c.some((x) => x.method === "editMessageText" && x.params.text === "Hello Sam"));
    const working = h.api.callsTo("sendMessage")[0];
    assert.equal(working?.params.text, "Working…");
    assert.ok(h.api.callsTo("sendChatAction").length >= 1);
    const edits = h.api.callsTo("editMessageText");
    assert.ok(edits.length >= 2, "deltas edit the working message before the final edit");
    assert.ok(edits.every((e) => e.params.message_id === 100));
    assert.deepEqual(a.sent, [{ chat: a.chats[0]?.id, text: "say hello", channel: "telegram", actor: "sam" }]);
    // the DM's chat is remembered locally
    const state = JSON.parse(readFileSync(join(h.ws.root, ".hl-cache/telegram.json"), "utf8"));
    assert.equal(state.dms[String(ME)].chat, a.chats[0]?.id);
  } finally {
    await h.done();
  }
});

test("/new and /use switch the DM's chat", async () => {
  const a = fakeAssistant();
  const h = await boot({ services: { assistant: a.svc } });
  try {
    h.api.push(dm(ME, "/new First"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("New chat chat1")));
    h.api.push(dm(ME, "/new Second"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("New chat chat2")));
    h.api.push(dm(ME, "/use chat1"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Now using chat chat1")));
    h.api.push(dm(ME, "hi"));
    await h.api.waitFor(() => a.sent.length === 1);
    assert.equal(a.sent[0]?.chat, a.chats[0]?.id);
  } finally {
    await h.done();
  }
});

test("/model lists the models (default and this chat marked) and switches this chat's model", async () => {
  const a = fakeAssistant();
  const caps = { tool_calls: true, vision: false, streaming: true };
  const providers = {
    models: () => [
      { id: "lms/spark", provider: "lms", label: "spark", capabilities: caps },
      { id: "or/a/one", provider: "or", label: "a/one", capabilities: caps },
    ],
    defaultModel: () => "or/a/one",
  } as unknown as ProvidersService;
  const h = await boot({ services: { assistant: a.svc, providers } });
  try {
    h.api.push(dm(ME, "/model lms/spark"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("New chat chat1")));
    assert.equal(a.chats[0]?.model, "lms/spark");
    h.api.push(dm(ME, "/model or/a/one"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t === "This chat now uses or/a/one."));
    h.api.push(dm(ME, "/model nope/x"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Unknown model nope/x")));
    h.api.push(dm(ME, "/model"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Models")));
    const list = sentTexts(h.api).find((t) => t.startsWith("Models")) as string;
    assert.match(list, /- lms\/spark\n\* or\/a\/one \(default\)/);
  } finally {
    await h.done();
  }
});

test("/stop cancels the answer in flight", async () => {
  const a = fakeAssistant(Array.from({ length: 50 }, () => "x"));
  const h = await boot({ services: { assistant: a.svc } });
  try {
    h.api.push(dm(ME, "long"));
    await h.api.waitFor((c) => c.some((x) => x.method === "editMessageText"));
    h.api.push(dm(ME, "/stop"));
    await h.api.waitFor(() => sentTexts(h.api).includes("Stopped the current answer."));
    await h.api.waitFor((c) => c.some((x) => x.method === "editMessageText" && String(x.params.text).endsWith("(stopped)")));
  } finally {
    await h.done();
  }
});

test("an assistant notice is shown as a short line", async () => {
  const a = fakeAssistant(["ok"], "the chat is near the model's context limit; older messages are trimmed");
  const h = await boot({ services: { assistant: a.svc } });
  try {
    h.api.push(dm(ME, "hi"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Note: the chat is near")));
    await h.api.waitFor((c) => c.some((x) => x.method === "editMessageText" && x.params.text === "ok"));
  } finally {
    await h.done();
  }
});

test("/run starts a plan-mode run with this chat as origin; /stop cancels runs of that origin only", async () => {
  const started: { prompt: string; mode?: string; origin?: string; ticket?: string }[] = [];
  const cancelled: string[] = [];
  const states: RunState[] = [
    { id: "r-other", runtime: "claude-code", mode: "ask", status: "running", started: "x", origin: "console" },
    { id: "r-tg-old", runtime: "claude-code", mode: "plan", status: "running", started: "x", origin: `telegram:${ME}` },
  ];
  const runs: RunManagerService = {
    async start(o) {
      started.push({
        prompt: o.prompt,
        ...(o.mode ? { mode: o.mode } : {}),
        ...(o.origin ? { origin: o.origin } : {}),
        ...(o.ticket ? { ticket: o.ticket } : {}),
      });
      const st: RunState = { id: "r-new", runtime: "claude-code", mode: "plan", status: "running", started: "x", ...(o.ticket ? { ticket: o.ticket } : {}) };
      if (o.origin) st.origin = o.origin;
      states.push(st);
      return st;
    },
    get: (id) => states.find((s) => s.id === id),
    active: () => states.filter((s) => s.status === "running"),
    events: async function* () {},
    async cancel(id) {
      cancelled.push(id);
      const s = states.find((x) => x.id === id);
      if (s) s.status = "cancelled";
    },
    ...m8Stubs(states[0] as RunState),
  };
  const h = await boot({ services: { runManager: runs } });
  try {
    h.api.push(dm(ME, "/run"));
    await h.api.waitFor(() => sentTexts(h.api).includes("Usage: /run [ticket id] <task>"));
    h.api.push(dm(ME, "/run T-001-sa summarise the spec"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Started run r-new on T-001-sa (plan mode)")));
    assert.deepEqual(started, [{ prompt: "summarise the spec", mode: "plan", origin: `telegram:${ME}`, ticket: "T-001-sa" }]);
    h.api.push(dm(ME, "/stop"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Cancelled run")));
    assert.deepEqual(cancelled.sort(), ["r-new", "r-tg-old"], "runs of this chat's origin, never the console's");
  } finally {
    await h.done();
  }
});

test("/todo and /ticket write through the verb registry as the person", async () => {
  const h = await boot();
  try {
    h.api.push(dm(ME, "/todo buy domain for the console"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Added todo")));
    assert.ok(sentTexts(h.api).includes("Added todo TD-002-sa."));
    // A todo is personal by default (Blueprint 31): people/<slug>/todos/.
    assert.match(readFileSync(join(h.ws.root, "people/sam/todos/TD-002-sa.toml"), "utf8"), /buy domain for the console/);

    h.api.push(dm(ME, "/ticket Gift card redemption"));
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Created ticket")));
    const line = sentTexts(h.api).find((t) => t.startsWith("Created ticket")) as string;
    const id = /Created ticket (T-\d+-sa)/.exec(line)?.[1];
    assert.ok(id, line);
    assert.match(line, /Gift card redemption/);

    h.api.push(dm(ME, "/todo"));
    await h.api.waitFor(() => sentTexts(h.api).includes("Usage: /todo <text>"));
  } finally {
    await h.done();
  }
});

test("approval card: buttons answer the queue via telegram and the card is edited", async () => {
  const q = fakeQueue([card("ap1"), card("ap2")]);
  const h = await boot({ services: { approvalQueue: q.svc } });
  try {
    await h.ws.runtime.ctx.emit("approval.requested", { id: "ap1", action: "git push", detail: "push m4 to origin", localOnly: false });
    await h.api.waitFor(() => h.api.callsTo("sendMessage").length === 1);
    const sent = h.api.callsTo("sendMessage")[0]?.params as { text: string; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } };
    assert.match(sent.text, /^Approval: git push/);
    const buttons = sent.reply_markup.inline_keyboard.flat();
    assert.deepEqual(
      buttons.map((b) => b.text),
      ["Allow", "Allow for this chat", "Deny"],
    );
    h.api.push(tap(ME, buttons[1]?.callback_data as string, 100, sent.text));
    await h.api.waitFor((c) => c.some((x) => x.method === "editMessageText"));
    assert.deepEqual(q.answers, [{ id: "ap1", decision: "allow", by: "sam", via: "telegram", scope: "chat" }]);
    assert.equal(h.api.callsTo("answerCallbackQuery")[0]?.params.text, "Allowed for this chat");
    const edit = h.api.callsTo("editMessageText")[0]?.params;
    assert.equal(edit?.message_id, 100);
    assert.equal(edit?.reply_markup, undefined, "buttons are removed");
    assert.match(String(edit?.text), /— Allowed for this chat by sam \(Telegram\)$/);

    // a stranger's tap is dropped
    h.api.push(tap(STRANGER, "ap:a:ap2", 100));
    await sleep(80);
    assert.equal(q.answers.length, 1);

    // decided elsewhere: the card is edited, and a timeout sends a notification
    await h.ws.runtime.ctx.emit("approval.requested", { id: "ap2", action: "git push", detail: "again", localOnly: false });
    await h.api.waitFor(() => h.api.callsTo("sendMessage").length === 2);
    await h.ws.runtime.ctx.emit("approval.decided", { id: "ap2", decision: "deny", by: "timeout", channel: "timeout" });
    await h.api.waitFor(() => sentTexts(h.api).some((t) => t.startsWith("Approval timed out")));
    await h.api.waitFor(() => h.api.callsTo("editMessageText").some((c) => /Expired/.test(String(c.params.text))));
  } finally {
    await h.done();
  }
});

test("a local_only card says it needs the console and has no buttons", async () => {
  const q = fakeQueue([card("ap9", { action: "shell", detail: "rm -rf build", local_only: true })]);
  const h = await boot({ services: { approvalQueue: q.svc } });
  try {
    await h.ws.runtime.ctx.emit("approval.requested", { id: "ap9", action: "shell", detail: "rm -rf build", localOnly: true });
    await h.api.waitFor(() => h.api.callsTo("sendMessage").length === 1);
    const p = h.api.callsTo("sendMessage")[0]?.params;
    assert.equal(p?.reply_markup, undefined);
    assert.match(String(p?.text), /needs the console/);
    // even a forged button press is refused by the queue
    h.api.push(tap(ME, "ap:a:ap9", 100, String(p?.text)));
    await h.api.waitFor(() => h.api.callsTo("answerCallbackQuery").length === 1);
    assert.equal(q.answers.length, 0);
  } finally {
    await h.done();
  }
});

test("/status and notifications", async () => {
  const run: RunState = {
    id: "r1",
    runtime: "claude-code",
    agent: "builder",
    ticket: "T-014-sa",
    mode: "ask",
    status: "running",
    started: "x",
    first_result_line: "Built slice 1",
  };
  const runs: RunManagerService = {
    start: async () => run,
    get: () => run,
    active: () => [run],
    events: async function* () {},
    cancel: async () => {},
    ...m8Stubs(run),
  };
  const q = fakeQueue([card("ap1")]);
  const h = await boot({ services: { approvalQueue: q.svc, runManager: runs } });
  try {
    h.api.push(dm(ME, "/status"));
    await h.api.waitFor(() => sentTexts(h.api).length === 1);
    const s = sentTexts(h.api)[0] as string;
    assert.match(s, /in flight/);
    assert.match(s, /1 approval waiting/);
    assert.match(s, /1 active run/);
    await h.ws.runtime.ctx.emit("run.finished", { runId: "r1", runtime: "claude-code", ticket: "T-014-sa", ok: true });
    await h.ws.runtime.ctx.emit("ticket.blocked", {
      id: "T-014-sa",
      blocked: true,
      by: "Q-001",
      next: "answer it",
      actor: { kind: "person", id: "sam", onBehalfOf: "sam" },
    });
    await h.api.waitFor(() => sentTexts(h.api).length === 3);
    assert.ok(sentTexts(h.api).includes("Run r1 on T-014-sa finished: Built slice 1"));
    assert.ok(sentTexts(h.api).includes("T-014-sa is blocked by Q-001. Next: answer it"));
  } finally {
    await h.done();
  }
});

test("backoff on 502, then the loop keeps polling", async () => {
  const h = await boot();
  try {
    h.api.failNext(502, 2);
    await h.api.waitFor(() => h.logs.filter((l) => l.includes("getUpdates failed")).length === 2);
    assert.match(h.logs[0] as string, /502/);
    assert.match(h.logs[1] as string, /retrying in 40 ms/, "the wait doubles");
    h.api.push(dm(ME, "/help"));
    await h.api.waitFor(() => sentTexts(h.api).length === 1);
  } finally {
    await h.done();
  }
});

test("stop ends the loop and aborts the poll in flight", async () => {
  const h = await boot({ pollTimeoutSec: 50 });
  try {
    await h.api.waitFor((c) => c.filter((x) => x.method === "getUpdates").length >= 2);
    const t0 = Date.now();
    await h.bot.stop();
    assert.ok(Date.now() - t0 < 1000, "a parked 50 s poll does not hold up shutdown");
    const n = h.api.callsTo("getUpdates").length;
    await sleep(100);
    assert.equal(h.api.callsTo("getUpdates").length, n);
    assert.equal(h.bot.stopped, true);
  } finally {
    await h.done();
  }
});

test("startTelegram: needs the token env var and an allowlist; reads settings from workspace.local.toml", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  const api = await startFakeBotApi();
  const logs: string[] = [];
  try {
    assert.equal(startTelegram(ws.runtime, { env: {}, log: (l) => logs.push(l) }), undefined);
    assert.equal(logs.length, 0, "silent when not configured");
    assert.equal(startTelegram(ws.runtime, { env: { HL_TELEGRAM_TOKEN: "x" }, log: (l) => logs.push(l) }), undefined);
    assert.match(logs[0] as string, /allowed_user_ids is empty/);

    writeFileSync(
      join(ws.root, "workspace.local.toml"),
      `schema_version = 1\n\n[[plugin]]\nid = "telegram"\nconfig = { token_env = "MY_BOT", allowed_user_ids = "${ME}, 77", notify = false }\n`,
    );
    const rt = await createRuntime({ cwd: ws.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog });
    try {
      const h = startTelegram(rt, { env: { MY_BOT: api.token }, apiBase: api.base, log: (l) => logs.push(l), pollTimeoutSec: 1 });
      assert.ok(h);
      api.push(dm(77, "/help"));
      await api.waitFor(() => api.callsTo("sendMessage").length === 1);
      await h.stop();
      assert.ok(existsSync(join(ws.root, "workspace.local.toml")));
    } finally {
      await rt.dispose();
    }
  } finally {
    await api.close();
    await ws.cleanup();
  }
});

test("Config parses the allowlist from text or a list and drops junk", () => {
  assert.deepEqual(Config.parse({ allowed_user_ids: "1, 2;3 x" }).allowed_user_ids, [1, 2, 3]);
  assert.deepEqual(Config.parse({ allowed_user_ids: [5, "6"] }).allowed_user_ids, [5, 6]);
  assert.deepEqual(Config.parse({}).allowed_user_ids, []);
});

test("superviseTelegram: a token saved with secret set starts the bot without a restart; a new token restarts it", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  const api = await startFakeBotApi();
  const logs: string[] = [];
  writeFileSync(
    join(ws.root, "workspace.local.toml"),
    `schema_version = 1\n\n[[plugin]]\nid = "telegram"\nconfig = { token_env = "MY_BOT_TOKEN", allowed_user_ids = ["${ME}"], notify = false }\n`,
  );
  const rt = await createRuntime({ cwd: ws.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog });
  const sup = superviseTelegram(rt, { env: {}, apiBase: api.base, log: (l) => logs.push(l), pollTimeoutSec: 1 });
  try {
    await sup.recheck();
    assert.equal(sup.handle, undefined, "no token yet: not started, silent");
    assert.deepEqual(logs, []);

    const r = await rt.run("secret set", { name: "MY_BOT_TOKEN", value: api.token }, { actor: { kind: "person", id: "sam", onBehalfOf: "sam" } });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(!JSON.stringify(r).includes(api.token));
    await sup.recheck();
    assert.ok(sup.handle, "started from the secret.saved event");
    api.push(dm(ME, "/help"));
    await api.waitFor(() => api.callsTo("sendMessage").length === 1);
    const first = sup.handle;
    await sup.recheck();
    assert.equal(sup.handle, first, "unchanged settings keep the running bot");

    // A setting change after start (config set) is picked up too: an empty allowlist stops the bot (fail-closed).
    const off = await rt.run(
      "config set",
      { plugin: "telegram", key: "allowed_user_ids", value: [], local: true },
      { actor: { kind: "person", id: "sam", onBehalfOf: "sam" } },
    );
    assert.ok(off.ok, JSON.stringify(off));
    await sup.recheck();
    assert.equal(sup.handle, undefined);
    assert.ok(logs.some((l) => /allowed_user_ids is empty/.test(l)));
  } finally {
    await sup.stop();
    await rt.dispose();
    await api.close();
    await ws.cleanup();
  }
});
