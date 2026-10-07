// Try before save: base URL normalising, LM Studio's native list, and probeDraft (list only, full, never writes).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { sseText, startFakeOpenAI } from "./fake-server.ts";
import { createProviders, normaliseBaseUrl, PROBE_DIR, parseLmStudioModels } from "./providers.ts";

const fixture = () => JSON.parse(readFileSync(join(import.meta.dirname, "lmstudio-native.fixture.json"), "utf8")) as { models: { key: string }[] };
const direct = (ws: TestWorkspace) => createProviders({ root: ws.root, files: ws.runtime.ctx.get("files"), sleep: async () => {}, retryBaseMs: 5 });

test("normaliseBaseUrl: the OpenAI root from what people paste", () => {
  const n = normaliseBaseUrl;
  assert.equal(n("http://192.168.1.14:1234"), "http://192.168.1.14:1234/v1");
  assert.equal(n("http://192.168.1.14:1234/"), "http://192.168.1.14:1234/v1");
  assert.equal(n("http://192.168.1.14:1234/v1/"), "http://192.168.1.14:1234/v1");
  assert.equal(n("http://192.168.1.14:1234/v1/models"), "http://192.168.1.14:1234/v1");
  assert.equal(n("http://192.168.1.14:1234/api/v1/models"), "http://192.168.1.14:1234/v1");
  assert.equal(n("http://192.168.1.14:1234/api/v1"), "http://192.168.1.14:1234/v1");
  assert.equal(n("192.168.1.14:1234"), "http://192.168.1.14:1234/v1");
  assert.equal(n("  https://api.openai.com/v1  "), "https://api.openai.com/v1");
  assert.equal(n("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1");
  assert.equal(n("https://openrouter.ai/api/v1/models"), "https://openrouter.ai/api/v1");
  assert.equal(n("https://proxy.example/openai"), "https://proxy.example/openai");
  assert.equal(n(""), "");
});

test("parseLmStudioModels: context, tool use, vision and loaded from LM Studio's native list (recorded fixture)", () => {
  const info = parseLmStudioModels(fixture());
  assert.ok(info);
  assert.deepEqual(
    info.map((m) => m.id),
    ["spark-x2.5-4b", "google/gemma-4-12b-qat", "meta/muse-glimmer"],
    "embedding models are left out",
  );
  assert.deepEqual(info[1], {
    id: "google/gemma-4-12b-qat",
    label: "Gemma 4 12B QAT",
    context_window: 262144,
    tool_calls: true,
    vision: true,
    loaded: true,
  });
  assert.equal(info[0]?.loaded, false);
  assert.equal(info[0]?.context_window, 1048576);
  assert.equal(info[0]?.vision, false);
  assert.equal(parseLmStudioModels({ data: [{ id: "x" }] }), undefined);
  assert.equal(parseLmStudioModels(null), undefined);
});

/** A fake LM Studio: the OpenAI list, the native list, and chat answers (streaming, tool calls). */
function fakeLmStudio() {
  const fx = fixture();
  return startFakeOpenAI((req) => {
    if (req.method === "GET" && req.path === "/api/v1/models") return { json: fx };
    if (req.method === "GET" && req.path === "/v1/models") return { json: { object: "list", data: fx.models.map((m) => ({ id: m.key, object: "model" })) } };
    if (req.method === "GET") return { status: 404, json: { error: "not found" } };
    if (req.body.tools)
      return {
        json: {
          choices: [
            {
              message: { content: null, tool_calls: [{ id: "c", type: "function", function: { name: "ping", arguments: '{"value":"ok"}' } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
      };
    if (req.body.stream) return { sse: sseText(["OK"]) };
    return { json: { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] } };
  });
}

test("probeDraft: list only, then a full probe of the loaded model, then a chosen one; never writes a file", async () => {
  const fake = await fakeLmStudio();
  const ws = await createTestWorkspace({ catalog });
  try {
    const p = direct(ws);
    const root = fake.url.replace(/\/v1$/, "");
    const before = readdirSync(ws.root, { recursive: true }).length;

    const list = await p.probeDraft({ base_url: `${root}/api/v1/models`, preset: "lmstudio" }, { listOnly: true });
    assert.equal(list.error, undefined);
    assert.equal(list.reachable, true);
    assert.equal(list.base_url, `${root}/v1`);
    assert.equal(list.models.length, 4, "the OpenAI list keeps every id");
    assert.equal(list.model_info?.length, 3);
    assert.equal(list.model_info?.find((m) => m.loaded)?.id, "google/gemma-4-12b-qat");
    assert.equal(list.chat, false, "list only: no prompt sent");
    assert.ok(fake.requests.every((r) => r.method === "GET"));

    const full = await p.probeDraft({ base_url: root, preset: "lmstudio" });
    assert.equal(full.error, undefined);
    assert.equal(full.model, "google/gemma-4-12b-qat", "the loaded model is tested by default");
    assert.deepEqual([full.chat, full.streaming, full.tool_calls], [true, true, true]);
    const chat = fake.requests.find((r) => r.method === "POST");
    assert.equal(chat?.path, "/v1/chat/completions");
    assert.equal(chat?.body.model, "google/gemma-4-12b-qat");

    const chosen = await p.probeDraft({ base_url: root, preset: "lmstudio" }, { model: "meta/muse-glimmer" });
    assert.equal(chosen.model, "meta/muse-glimmer");
    assert.equal(fake.requests.at(-1)?.body.model, "meta/muse-glimmer");

    assert.equal(readdirSync(ws.root, { recursive: true }).length, before, "no file written");
    assert.ok(!existsSync(join(ws.root, PROBE_DIR)));
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("probeDraft: a plain OpenAI server fills model_info from ids; bad input and a dead server answer with an error", async () => {
  const fake = await startFakeOpenAI((req) => {
    if (req.method === "GET" && req.path === "/v1/models") return { json: { object: "list", data: [{ id: "m1" }, { id: "m2" }] } };
    return { status: 404, json: { error: "not found" } };
  });
  const ws = await createTestWorkspace({ catalog });
  let closed = false;
  try {
    const p = direct(ws);
    const list = await p.probeDraft({ base_url: fake.url }, { listOnly: true });
    assert.equal(list.error, undefined);
    assert.deepEqual(list.model_info, [{ id: "m1" }, { id: "m2" }]);
    assert.equal(list.provider, "draft");

    const bad = await p.probeDraft({ base_url: "ftp://x" });
    assert.equal(bad.error?.code, "bad_request");
    const key = await p.probeDraft({ base_url: fake.url, key_env: "sk-123" });
    assert.equal(key.error?.code, "bad_request");
    assert.match(key.error?.message ?? "", /environment variable NAME/);
    const preset = await p.probeDraft({ base_url: fake.url, preset: "nope" });
    assert.equal(preset.error?.code, "bad_request");

    const port = new URL(fake.url).port;
    await fake.close();
    closed = true;
    const dead = await p.probeDraft({ base_url: `http://127.0.0.1:${port}` }, { listOnly: true });
    assert.equal(dead.reachable, false);
    assert.equal(dead.error?.code, "network");
  } finally {
    await ws.cleanup();
    if (!closed) await fake.close();
  }
});

test("probe: a reasoning model that spends the tiny budget thinking still counts as streaming", async () => {
  const think = (t: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "c", choices: [{ index: 0, delta: { reasoning_content: t }, finish_reason: finish }] })}\n\n`;
  const fake = await startFakeOpenAI((req) => {
    if (req.method === "GET") return { json: { data: [{ id: "thinker" }] } };
    if (req.body.stream) return { sse: [think("The"), think(" user"), think(" wants", "length"), "data: [DONE]\n\n"] };
    return { json: { choices: [{ message: { content: "", reasoning_content: "The user" }, finish_reason: "length" }] } };
  });
  const ws = await createTestWorkspace({ catalog });
  try {
    const r = await direct(ws).probeDraft({ base_url: fake.url });
    assert.equal(r.chat, true);
    assert.equal(r.streaming, true);
    assert.equal(r.tool_calls, false);
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

// Live check against a real LM Studio: HL_LIVE=1 (optionally HL_LIVE_LMSTUDIO=<base url>).
test("live: LM Studio list and full probe", { skip: process.env.HL_LIVE !== "1" }, async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const p = direct(ws);
    const base_url = process.env.HL_LIVE_LMSTUDIO ?? "http://192.168.1.14:1234";
    const list = await p.probeDraft({ base_url, preset: "lmstudio" }, { listOnly: true });
    console.log(JSON.stringify({ ...list, models: list.models.length }, null, 2));
    assert.equal(list.reachable, true);
    const full = await p.probeDraft({ base_url, preset: "lmstudio" });
    console.log(JSON.stringify({ ...full, models: full.models.length, model_info: full.model_info?.length }, null, 2));
    assert.equal(full.chat, true);
  } finally {
    await ws.cleanup();
  }
});
