// Milestone 7: machine secrets through the console. The value goes to the knowledge repo's .env and nowhere else.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { SetupStatus, VerbCallResult } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { setupStatus } from "./knowledge.ts";

let ws: TestWorkspace;
let app: Hono;
const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };
const SECRET = "987654:AAH-very-secret-token";

async function call(verb: string, input: Record<string, unknown>) {
  const res = await app.request(`/api/v1/verbs/${verb}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ input }) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as VerbCallResult };
}
const allFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)])) : [];
async function telegramStep(env: Record<string, string> = {}) {
  await app.request("/api/v1/setup"); // mounts what the checklist reads
  return (await setupStatus(ws.runtime, { env })).steps.find((s) => s.id === "telegram") as SetupStatus["steps"][number];
}

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  app = createApp(ws.runtime);
});
after(async () => {
  await ws.cleanup();
});

describe("secret set and the setup checklist", () => {
  test("setup: telegram is open until the token and an allowed id are there; settings are read fresh", async () => {
    let step = await telegramStep();
    assert.equal(step.done, false);
    assert.match(step.detail, /paste the token below or set HL_TELEGRAM_TOKEN/);
    // The allowed ids saved after the console started count at once (a list in workspace.local.toml).
    const ids = await call("config/set", { plugin: "telegram", key: "allowed_user_ids", value: ["4242"], local: true });
    assert.equal(ids.status, 200, ids.text);
    step = await telegramStep();
    assert.equal(step.done, false, "no token yet");
  });

  test("POST secret set: saved in .env, never echoed, not in the activity log; setup flips to done", async () => {
    const r = await call("secret/set", { name: "HL_TELEGRAM_TOKEN", value: SECRET });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(SECRET), "the response never carries the value");
    assert.match((r.body as { text: string }).text, /HL_TELEGRAM_TOKEN saved in this machine's \.env \(gitignored\)/);
    assert.match(readFileSync(join(ws.root, ".env"), "utf8"), /^HL_TELEGRAM_TOKEN=987654:AAH-very-secret-token$/m);
    assert.match(readFileSync(join(ws.root, ".gitignore"), "utf8"), /^\.env$/m);
    const logged = allFiles(join(ws.root, "activity")).filter((f) => readFileSync(f, "utf8").includes(SECRET));
    assert.deepEqual(logged, []);
    assert.ok(
      allFiles(join(ws.root, "activity")).some((f) => readFileSync(f, "utf8").includes('"secret set"')),
      "the activity line is written",
    );

    const step = await telegramStep();
    assert.equal(step.done, true);
    assert.match(step.detail, /token in HL_TELEGRAM_TOKEN \(this machine's \.env\); 1 allowed id/);
    assert.match((await telegramStep({ HL_TELEGRAM_TOKEN: "x" })).detail, /\(environment\)/);
  });

  test("a secret pasted into the name field is refused without repeating it", async () => {
    const r = await call("secret/set", { name: SECRET, value: "x" });
    assert.equal(r.status, 422, r.text);
    assert.ok(!r.text.includes(SECRET));
    const empty = await call("secret/set", { name: "OPENROUTER_API_KEY", value: "  " });
    assert.equal(empty.status, 422, empty.text);
    assert.equal((empty.body as { error: { rule: string } }).error.rule, "bad-secret-value");
  });

  test("secret status lists names and sources, never values", async () => {
    writeFileSync(join(ws.root, ".env"), `${readFileSync(join(ws.root, ".env"), "utf8")}# a note\n`);
    const r = await call("secret/status", {});
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(SECRET));
    const rows = (r.body as { data: { name: string; source: string; used_by?: string }[] }).data;
    const tg = rows.find((x) => x.name === "HL_TELEGRAM_TOKEN");
    assert.equal(tg?.used_by, "telegram.token_env");
    assert.equal(tg?.source, process.env.HL_TELEGRAM_TOKEN ? "environment" : ".env");
    const asked = await call("secret/status", { names: ["NOT_SET_ANYWHERE_X"] });
    assert.deepEqual((asked.body as { data: unknown }).data, [{ name: "NOT_SET_ANYWHERE_X", source: "missing" }]);
  });
});
