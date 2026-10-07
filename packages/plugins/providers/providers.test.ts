import assert from "node:assert/strict";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CompletionDelta, ProvidersService } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { readProvidersConfig } from "./config.ts";
import { type FakeRequest, lastMessage, providersToml, sseText, sseToolCalls, startFakeOpenAI } from "./fake-server.ts";
import { createProviders, PROBE_DIR } from "./providers.ts";
import { Accumulator, classifyStatus, type ProviderError, parseRetryAfter, SseLines } from "./wire.ts";

async function collect(it: AsyncIterable<CompletionDelta>): Promise<CompletionDelta[]> {
  const out: CompletionDelta[] = [];
  for await (const d of it) out.push(d);
  return out;
}

function direct(ws: TestWorkspace, sleeps: number[] = []) {
  return createProviders({
    root: ws.root,
    files: ws.runtime.ctx.get("files"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    retryBaseMs: 5,
  });
}

test("SSE lines and the accumulator handle split lines, split tool arguments, usage without choices", () => {
  const lines = new SseLines();
  const parts = [...sseToolCalls([{ id: "call_a", name: "search", args: '{"q":"login"}' }])];
  const payloads = parts.flatMap((p) => lines.feed(p)).concat(lines.end());
  assert.equal(payloads.at(-1), "[DONE]");
  const acc = new Accumulator();
  for (const p of payloads.slice(0, -1)) acc.feed(JSON.parse(p));
  const closed = acc.close();
  assert.deepEqual(closed[0], { type: "tool_call", id: "call_a", name: "search", arguments: '{"q":"login"}' });
  assert.deepEqual(closed[1], { type: "usage", input_tokens: 20, output_tokens: 9 });
  assert.deepEqual(closed[2], { type: "done", finish_reason: "tool_calls" });
  assert.equal(classifyStatus(401, ""), "auth");
  assert.equal(classifyStatus(429, ""), "rate_limit");
  assert.equal(classifyStatus(400, '{"error":{"message":"This model\'s maximum context length is 4096 tokens"}}'), "context_exceeded");
  assert.equal(classifyStatus(400, "bad"), "bad_request");
  assert.equal(classifyStatus(503, ""), "server");
  assert.equal(parseRetryAfter("3"), 3);
  assert.equal(parseRetryAfter(null), undefined);
});

test("config: presets fill rows, bad compat keys and key values are refused", () => {
  const c = readProvidersConfig({
    providers: [
      { id: "ollama" },
      { id: "x", preset: "custom", base_url: "http://10.0.0.2:9000/v1/", compat: { nope: true } },
      { id: "y", preset: "openai", key_env: "sk-123" },
    ],
    models: [{ id: "qwen3:14b", provider: "ollama", context_window: 32768 }],
    assistant_model: "ollama/qwen3:14b",
  });
  assert.equal(c.providers.length, 1);
  const o = c.providers[0];
  assert.equal(o?.base_url, "http://localhost:11434/v1");
  assert.equal(o?.local, true);
  assert.equal(o?.timeout_ms, 300_000);
  assert.equal(c.models[0]?.id, "ollama/qwen3:14b");
  assert.equal(c.models[0]?.capabilities.tool_calls, false);
  assert.equal(c.roles.assistant, "ollama/qwen3:14b");
  assert.equal(c.problems.length, 2);
  assert.match(c.problems.join("\n"), /compat switch nope/);
  assert.match(c.problems.join("\n"), /NAME/);
});

test("complete streams text and assembled tool calls, sends compat-shaped bodies, logs usage", async () => {
  const fake = await startFakeOpenAI((req) => {
    if (lastMessage(req.body)?.role === "tool") return { sse: sseText(["Found ", "two ", "tickets."]) };
    return { sse: sseToolCalls([{ id: "call_1", name: "search", args: '{"q":"uat login"}' }]) };
  });
  const ws = await createTestWorkspace({ catalog });
  try {
    appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
    await ws.runtime.mountAll();
    const p: ProvidersService = ws.runtime.ctx.get("providers");
    assert.deepEqual(
      p.models().map((m) => m.id),
      ["fake/m1", "fake/plain"],
    );
    assert.equal(p.defaultModel("assistant"), "fake/m1");
    const tools = [{ name: "search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } }];
    const first = await collect(
      p.complete({
        model: "fake/m1",
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "find uat" },
        ],
        tools,
      }),
    );
    assert.deepEqual(first[0], { type: "tool_call", id: "call_1", name: "search", arguments: '{"q":"uat login"}' });
    const body = fake.requests[0]?.body as Record<string, unknown>;
    assert.equal(body.model, "m1");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal((body.messages as { role: string }[])[0]?.role, "system");
    assert.equal((body.tools as unknown[]).length, 1);
    assert.equal(fake.requests[0]?.headers.authorization, undefined, "keyless: no auth header");

    const second = await collect(
      p.complete({
        model: "fake/m1",
        messages: [
          { role: "user", content: "find uat" },
          { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "search", arguments: '{"q":"uat login"}' }] },
          { role: "tool", content: "2 hits", tool_call_id: "call_1" },
        ],
      }),
    );
    assert.equal(
      second
        .filter((d) => d.type === "text")
        .map((d) => (d as { text: string }).text)
        .join(""),
      "Found two tickets.",
    );
    const wire = ((fake.requests[1] as FakeRequest).body.messages as Record<string, unknown>[])[1] as { tool_calls: { function: { name: string } }[] };
    assert.equal(wire.tool_calls[0]?.function.name, "search");
    const usageFiles = readdirSync(join(ws.root, "usage"));
    assert.equal(usageFiles.length, 1);
    const lines = readFileSync(join(ws.root, "usage", usageFiles[0] as string), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[1].input_tokens, 12);
    assert.equal(lines[1].billing, "local");
    assert.equal(lines[1].ok, true);

    // Config is re-read on every call: a new default applies with no restart.
    const t = readFileSync(join(ws.root, "workspace.toml"), "utf8").replace('default_model = "fake/m1"', 'default_model = "fake/plain"');
    writeFileSync(join(ws.root, "workspace.toml"), t);
    assert.equal(p.defaultModel(), "fake/plain");
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("complete retries 429 with Retry-After and 503, then maps 401 and keys by env var", async () => {
  let n = 0;
  const fake = await startFakeOpenAI((req) => {
    if (req.headers.authorization === "Bearer wrong") return { status: 401, json: { error: { message: "invalid api key" } } };
    n++;
    if (n === 1) return { status: 429, headers: { "retry-after": "2" }, json: { error: { message: "slow down" } } };
    if (n === 2) return { status: 503, json: { error: { message: "busy" } } };
    return { sse: sseText(["ok"]) };
  });
  const ws = await createTestWorkspace({ catalog });
  try {
    appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
    const sleeps: number[] = [];
    const p = direct(ws, sleeps);
    const out = await collect(p.complete({ model: "fake/m1", messages: [{ role: "user", content: "hi" }] }));
    assert.equal((out[0] as { text: string }).text, "ok");
    assert.deepEqual(sleeps, [2000, 10], "Retry-After honoured, then backoff");

    // Retries exhausted -> the stable code.
    const fail = await startFakeOpenAI(() => ({ status: 500, json: { error: { message: "boom" } } }));
    writeFileSync(join(ws.root, "workspace.toml"), readFileSync(join(ws.root, "workspace.toml"), "utf8").replace(fake.url, fail.url));
    await assert.rejects(collect(p.complete({ model: "fake/m1", messages: [{ role: "user", content: "hi" }] })), (e: ProviderError) => e.code === "server");
    assert.equal(fail.requests.length, 3, "1 try + 2 retries");
    await fail.close();

    // 401 is not retried; the key comes from the env var named in the row.
    writeFileSync(
      join(ws.root, "workspace.toml"),
      readFileSync(join(ws.root, "workspace.toml"), "utf8").replace(fail.url, fake.url).replace("retries = 2", 'retries = 2, key_env = "FAKE_KEY"'),
    );
    const keyed = createProviders({ root: ws.root, files: ws.runtime.ctx.get("files"), env: { FAKE_KEY: "wrong" }, sleep: async () => {} });
    const before = fake.requests.length;
    await assert.rejects(
      collect(keyed.complete({ model: "fake/m1", messages: [{ role: "user", content: "hi" }] })),
      (e: ProviderError) => e.code === "auth" && /invalid api key/.test(e.message),
    );
    assert.equal(fake.requests.length, before + 1);
    // Unknown model: bad_request before any HTTP call.
    await assert.rejects(collect(keyed.complete({ model: "nope/x", messages: [] })), (e: ProviderError) => e.code === "bad_request");
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});

test("probe: reach, list models, tiny prompt, streaming, tool call; result cached and applied", async () => {
  const fake = await startFakeOpenAI((req) => {
    if (req.method === "GET") return { json: { object: "list", data: [{ id: "m1" }, { id: "plain" }] } };
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
    return { json: { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } } };
  });
  const ws = await createTestWorkspace({ catalog });
  try {
    // fake/plain has no tool_calls in its row, so a probe against it may fill it in.
    appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url).replace('default_model = "fake/m1"', 'default_model = "fake/plain"'));
    const p = direct(ws);
    assert.equal(p.models().find((m) => m.id === "fake/plain")?.capabilities.tool_calls, false);
    const r = await p.probe("fake");
    assert.deepEqual(r, {
      provider: "fake",
      reachable: true,
      models: ["m1", "plain"],
      model_info: [{ id: "m1" }, { id: "plain" }],
      model: "plain",
      chat: true,
      streaming: true,
      tool_calls: true,
    });
    assert.ok(existsSync(join(ws.root, PROBE_DIR, "fake.json")));
    assert.equal(p.models().find((m) => m.id === "fake/plain")?.capabilities.tool_calls, true);
    const missing = await p.probe("nope");
    assert.equal(missing.reachable, false);
    assert.equal(missing.error?.code, "bad_request");
  } finally {
    await ws.cleanup();
    await fake.close();
  }
});
