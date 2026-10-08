// POST /models/try with a pasted key (milestone 7): the key reaches the remote server for that request only; it is
// never written to a file, logged, or returned (not even when the server echoes it in an error).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ApiResponse, ModelProbe } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { type FakeServer, startFakeOpenAI } from "@helmlock/plugins/providers/fake-server.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { scrub } from "./models.ts";

const KEY = "sk-or-v1-pasted-secret-0123456789";
let ws: TestWorkspace;
let app: Hono;
let fake: FakeServer;
const logged: string[] = [];

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };
async function post(body: unknown): Promise<{ status: number; text: string }> {
  const res = await app.request("/api/v1/models/try", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

before(async () => {
  // Wants exactly KEY; a wrong key is echoed back in the error, as some servers do.
  fake = await startFakeOpenAI((req) => {
    const auth = String(req.headers.authorization ?? "");
    if (auth !== `Bearer ${KEY}`) return { status: 401, json: { error: { message: `invalid key ${auth.replace(/^Bearer /, "")}` } } };
    return { json: { data: [{ id: "m1" }, { id: "m2" }] } };
  });
  ws = await createTestWorkspace({ catalog });
  app = createApp(ws.runtime, { log: (l) => logged.push(l), heartbeatMs: 50 });
});
after(async () => {
  await ws.cleanup();
  await fake.close();
});

const filesContaining = (root: string, needle: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .filter((p) => readFileSync(p, "utf8").includes(needle));

test("a pasted key is used for the one request, never persisted, logged or returned", async () => {
  const without = await post({ base_url: fake.url, list_only: true });
  const w = JSON.parse(without.text) as ApiResponse<ModelProbe>;
  assert.ok(w.ok);
  assert.equal(w.data.error?.code, "auth");

  const withKey = await post({ base_url: fake.url, key: KEY, list_only: true });
  assert.equal(withKey.status, 200);
  const r = JSON.parse(withKey.text) as ApiResponse<ModelProbe>;
  assert.ok(r.ok, withKey.text);
  assert.deepEqual(r.data.models, ["m1", "m2"]);
  assert.ok(!withKey.text.includes(KEY));
  assert.equal(fake.requests.at(-1)?.headers.authorization, `Bearer ${KEY}`);

  // A wrong pasted key that the server echoes is hidden in the answer.
  const wrong = `${KEY}-wrong`;
  const bad = await post({ base_url: fake.url, key: wrong, list_only: true });
  assert.ok(!bad.text.includes(wrong), bad.text);
  assert.match(bad.text, /\[key hidden\]/);

  // A full probe too; then nothing on disk or in the log holds the key, and the next try without it has no key.
  await post({ base_url: fake.url, key: KEY, model: "m1" });
  assert.deepEqual(filesContaining(ws.root, "pasted-secret"), []);
  assert.ok(!logged.some((l) => l.includes("pasted-secret")));
  const after = await post({ base_url: fake.url, list_only: true });
  assert.match(after.text, /"code":"auth"/);
  assert.equal((await post({ base_url: fake.url, key: 42 })).status, 400);
});

test("scrub hides every occurrence of a secret", () => {
  assert.deepEqual(scrub({ a: "x sk-1 y", b: ["sk-1"], c: 2 }, "sk-1"), { a: "x [key hidden] y", b: ["[key hidden]"], c: 2 });
});
