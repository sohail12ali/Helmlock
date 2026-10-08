// Settings page diagnostics: the plugins this server loaded, the .env names (never values), the engine re-test, and
// `config set` with unset (Reset to default) and `applies` through the console.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { MachineEnvView, ServerPluginsView, SettingsView, VerbCallResult } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

let ws: TestWorkspace;
let app: Hono;
const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; text: string; data: T }> {
  const res = await app.request(`/api/v1${path}`, init);
  const text = await res.text();
  return { status: res.status, text, data: (JSON.parse(text) as { data: T }).data };
}
async function call(verb: string, input: Record<string, unknown>) {
  const res = await app.request(`/api/v1/verbs/${verb}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ input }) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as VerbCallResult };
}

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  app = createApp(ws.runtime);
});
after(async () => {
  await ws.cleanup();
});

describe("settings diagnostics", () => {
  test("GET /server/plugins lists every row with version, provides and status", async () => {
    const r = await json<ServerPluginsView>("/server/plugins");
    assert.equal(r.status, 200, r.text);
    const files = r.data.plugins.find((p) => p.id === "work-log");
    assert.ok(files, r.text);
    assert.equal(files.status, "ok");
    assert.equal(files.version, "0.1.0");
    assert.deepEqual(files.provides, ["worklog"]);
    assert.ok(r.data.plugins.every((p) => ["ok", "pending", "failed", "off"].includes(p.status)));
  });

  test("GET /settings/env gives the .env path and names, never values", async () => {
    writeFileSync(join(ws.root, ".env"), "ZED_KEY=secret-one\nALPHA_TOKEN='secret-two'\nEMPTY=\n");
    const r = await json<MachineEnvView>("/settings/env");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.file, join(ws.root, ".env"));
    assert.equal(r.data.exists, true);
    assert.deepEqual(r.data.names, ["ALPHA_TOKEN", "ZED_KEY"]);
    assert.ok(!r.text.includes("secret-one") && !r.text.includes("secret-two"));
  });

  test("POST /engines/test needs the write header", async () => {
    const r = await app.request("/api/v1/engines/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 403);
  });

  test("settings carry applies; config set reports it, and unset goes back to the default", async () => {
    const view = await json<SettingsView>("/settings");
    const agents = view.data.sections.find((s) => s.id === "agents");
    const silence = agents?.plugins.find((p) => p.plugin === "runtimes")?.fields.find((f) => f.key === "silence_sec");
    assert.equal(silence?.applies, "restart");

    const set = await call("config/set", { plugin: "runtimes", key: "silence_sec", value: 900 });
    assert.equal(set.status, 200, set.text);
    assert.match((set.body as { text: string }).text, /restart hl serve/);
    const file = join(ws.root, "workspace.toml");
    assert.match(readFileSync(file, "utf8"), /silence_sec = 900/);

    const reset = await call("config/set", { plugin: "runtimes", key: "silence_sec", unset: true });
    assert.equal(reset.status, 200, reset.text);
    assert.match((reset.body as { text: string }).text, /reset runtimes\.silence_sec in workspace\.toml/);
    assert.doesNotMatch(readFileSync(file, "utf8"), /silence_sec/);
    const after = await json<SettingsView>("/settings");
    const v = after.data.sections.find((s) => s.id === "agents")?.plugins.find((p) => p.plugin === "runtimes")?.values.silence_sec;
    assert.deepEqual(v, { value: 1800, source: "default" });

    const again = await call("config/set", { plugin: "runtimes", key: "silence_sec", unset: true });
    assert.equal(again.status, 200, again.text);
    assert.match((again.body as { text: string }).text, /unchanged \(not set\)/);
    const none = await call("config/set", { plugin: "runtimes", key: "silence_sec" });
    assert.equal(none.status, 422, none.text);
  });
});
