import assert from "node:assert/strict";
import { appendFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ApiResponse, AssistantEvent, ChatDetail, ChatSummary, ModelProbe, ModelsView } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { type FakeServer, providersToml, sseText, startFakeOpenAI } from "@helmlock/plugins/providers/fake-server.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

let ws: TestWorkspace;
let app: Hono;
let fake: FakeServer;

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

async function post<T>(path: string, body: unknown, headers: Record<string, string> = HEADERS): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
async function get<T>(path: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.request(`/api/v1${path}`);
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
const dataOf = <T>(r: { body: ApiResponse<T> }): T => {
  assert.ok(r.body.ok, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
};

/** Reads "assistant" SSE frames until a done event (or the limit). */
async function readTurn(res: Response): Promise<AssistantEvent[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: AssistantEvent[] = [];
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i = buf.indexOf("\n\n");
    while (i >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (frame.startsWith("event: assistant\n")) out.push(JSON.parse(frame.split("\ndata: ")[1] as string) as AssistantEvent);
      i = buf.indexOf("\n\n");
    }
    if (out.some((e) => e.type === "done")) break;
  }
  await reader.cancel();
  return out;
}

before(async () => {
  fake = await startFakeOpenAI((req) => (req.method === "GET" ? { json: { data: [{ id: "m1" }] } } : { sse: sseText(["Hi ", "Sam."]) }));
  ws = await createTestWorkspace({ catalog });
  appendFileSync(join(ws.root, "workspace.toml"), providersToml(fake.url));
  app = createApp(ws.runtime, { log: () => {}, heartbeatMs: 50 });
});
after(async () => {
  await ws.cleanup();
  await fake.close();
});

test("GET /models and POST /models/test", async () => {
  const view = dataOf(await get<ModelsView>("/models"));
  assert.equal(view.default, "fake/m1");
  assert.deepEqual(
    view.models.map((m) => m.id),
    ["fake/m1", "fake/plain"],
  );
  assert.equal(view.providers[0]?.base_url, fake.url);
  const noHeader = await post("/models/test", { provider: "fake" }, { "content-type": "application/json" });
  assert.equal(noHeader.status, 403);
  const probe = dataOf(await post<ModelProbe>("/models/test", { provider: "fake" }));
  assert.equal(probe.reachable, true);
  assert.deepEqual(probe.models, ["m1"]);
  assert.equal(probe.streaming, true);
});

test("POST /models/try probes a provider that is not saved: write protection, no files written", async () => {
  const snapshot = () =>
    readdirSync(ws.root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const p = join(d.parentPath, d.name);
        return `${p}:${statSync(p).mtimeMs}`;
      })
      .sort();
  const before = snapshot();
  const noHeader = await post("/models/try", { base_url: fake.url }, { "content-type": "application/json" });
  assert.equal(noHeader.status, 403);
  const foreign = await post("/models/try", { base_url: fake.url }, { ...HEADERS, origin: "http://evil.example" });
  assert.equal(foreign.status, 403);
  const missing = await post("/models/try", { preset: "lmstudio" });
  assert.equal(missing.status, 400);
  const badFlag = await post("/models/try", { base_url: fake.url, list_only: "yes" });
  assert.equal(badFlag.status, 400);

  const posts = () => fake.requests.filter((r) => r.method === "POST").length;
  const sent = posts();
  const list = dataOf(await post<ModelProbe>("/models/try", { base_url: `${fake.url}/models`, list_only: true }));
  assert.equal(list.reachable, true);
  assert.deepEqual(list.models, ["m1"]);
  assert.deepEqual(list.model_info, [{ id: "m1" }]);
  assert.equal(list.base_url, fake.url);
  assert.equal(posts(), sent, "list only sends no prompt");

  const full = dataOf(await post<ModelProbe>("/models/try", { base_url: fake.url, model: "m1" }));
  assert.equal(full.model, "m1");
  assert.equal(full.streaming, true);
  assert.ok(posts() > sent);

  const bad = dataOf(await post<ModelProbe>("/models/try", { base_url: fake.url, key_env: "sk-not-a-name" }));
  assert.equal(bad.error?.code, "bad_request");
  assert.deepEqual(snapshot(), before, "the try route writes nothing locally");
});

test("chat routes: create, send (202), SSE stream and replay, detail, model switch", async () => {
  const foreign = await post("/chats", {}, { ...HEADERS, origin: "http://evil.example" });
  assert.equal(foreign.status, 403);
  const created = await post<ChatSummary>("/chats", { title: "Planning" });
  assert.equal(created.status, 201);
  const chat = dataOf(created);
  assert.equal(chat.title, "Planning");
  assert.equal(chat.channel, "console");

  const stream = await app.request(`/api/v1/chats/${chat.id}/events`);
  assert.equal(stream.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const sent = await post<{ chat: string; accepted: boolean }>(`/chats/${chat.id}/messages`, { text: "hello" });
  assert.equal(sent.status, 202);
  const live = await readTurn(stream);
  assert.deepEqual(
    live.map((e) => e.type),
    ["message", "delta", "delta", "message", "done"],
  );

  // A late subscriber gets the last turn replayed.
  const replay = await readTurn(await app.request(`/api/v1/chats/${chat.id}/events`));
  assert.equal(replay.length, live.length);

  const detail = dataOf(await get<ChatDetail>(`/chats/${chat.id}`));
  assert.deepEqual(
    detail.messages.map((m) => [m.role, m.text]),
    [
      ["user", "hello"],
      ["assistant", "Hi Sam."],
    ],
  );
  assert.equal(dataOf(await get<ChatSummary[]>("/chats"))[0]?.id, chat.id);

  const switched = dataOf(await post<ChatSummary>(`/chats/${chat.id}/model`, { model: "fake/plain" }));
  assert.equal(switched.model, "fake/plain");
  const bad = await post(`/chats/${chat.id}/model`, { model: "nope/x" });
  assert.equal(bad.status, 400);
  assert.equal((await post(`/chats/${chat.id}/messages`, { text: "" })).status, 400);
  assert.equal((await get("/chats/ch-20260101-000000-zzzz")).status, 404);
  assert.equal((await post("/chats/ch-20260101-000000-zzzz/messages", { text: "x" })).status, 404);
});
