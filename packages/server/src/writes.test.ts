import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ApiResponse, SettingsView, TodoList, VerbCallResult, VerbCatalog } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { createWriteQueue, verbIdFromPath } from "./writes.ts";

let ws: TestWorkspace;
let app: Hono;

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

async function call(verb: string, input: Record<string, unknown>, o: { dry_run?: boolean; headers?: Record<string, string> } = {}) {
  const res = await app.request(`/api/v1/verbs/${verb}`, {
    method: "POST",
    headers: o.headers ?? HEADERS,
    body: JSON.stringify(o.dry_run === undefined ? { input } : { input, dry_run: o.dry_run }),
  });
  return { status: res.status, body: (await res.json()) as VerbCallResult & { error?: { rule: string; fix?: string } } };
}
async function data<T>(path: string): Promise<T> {
  const res = await app.request(path);
  const body = (await res.json()) as ApiResponse<T>;
  assert.equal(res.status, 200, JSON.stringify(body));
  return (body as { ok: true; data: T }).data;
}
const toml = async (rel: string) => (await ws.runtime.ctx.get("files").readTomlRaw(rel)).data;
const ticketToml = () => readFileSync(join(ws.root, "artifacts/T-001-sa/ticket.toml"), "utf8");
const activityLines = (): { verb: string; code: number; entity?: string }[] => {
  const out: { verb: string; code: number; entity?: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".jsonl"))
        for (const l of readFileSync(join(d, e.name), "utf8").split("\n")) if (l.trim()) out.push(JSON.parse(l) as { verb: string; code: number });
    }
  };
  walk(join(ws.root, "activity"));
  return out;
};
const settingOf = (v: SettingsView, plugin: string, key: string) => {
  for (const s of v.sections)
    for (const p of s.plugins)
      if (p.plugin === plugin && key in p.values) return { section: s.id, ...p.values[key]!, field: p.fields.find((f) => f.key === key) };
  return undefined;
};

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  app = createApp(ws.runtime, { log: () => {} });
});
after(async () => {
  await ws.cleanup();
});

describe("verb calls", () => {
  test("request checks: header, content type, origin, method, allow-list", async () => {
    const noHeader = await call("ticket/move", { id: "T-001-sa", stage: "plan" }, { headers: { "content-type": "application/json" } });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error?.rule, "write-header-missing");

    const form = await call("ticket/move", { id: "T-001-sa", stage: "plan" }, { headers: { "content-type": "text/plain", "x-helmlock-request": "1" } });
    assert.equal(form.status, 415);

    const foreign = await call("ticket/move", { id: "T-001-sa", stage: "plan" }, { headers: { ...HEADERS, origin: "http://evil.example" } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error?.rule, "bad-origin");
    const nullOrigin = await call("ticket/move", { id: "T-001-sa", stage: "plan" }, { headers: { ...HEADERS, origin: "null" } });
    assert.equal(nullOrigin.status, 403);

    for (const v of ["run", "init", "harness/sync", "ticket/list", "serve"]) {
      const r = await call(v, {});
      assert.equal(r.status, 403, v);
      assert.equal(r.body.error?.rule, "verb-not-allowed", v);
    }
    const put = await app.request("/api/v1/verbs/ticket/move", { method: "PUT", headers: HEADERS, body: "{}" });
    assert.equal(put.status, 405);
    const badJson = await app.request("/api/v1/verbs/ticket/move", { method: "POST", headers: HEADERS, body: "{" });
    assert.equal(badJson.status, 400);
    assert.equal(ticketToml().includes('stage = "spec"'), true, "nothing moved");
  });

  test("same-origin Origin is accepted", async () => {
    const r = await app.request("http://127.0.0.1:4317/api/v1/verbs/validate", {
      method: "POST",
      headers: { ...HEADERS, origin: "http://127.0.0.1:4317" },
      body: JSON.stringify({ input: {} }),
    });
    assert.notEqual(r.status, 403, await r.clone().text());
  });

  test("bad input: 400 with the verb's rule", async () => {
    const r = await call("ticket/move", { id: "T-001-sa" });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error?.rule, "bad-input");
  });

  test("gate block: 409 with the gate rule; answer then move: 200 and the file changed", async () => {
    const before = ticketToml();
    const blocked = await call("ticket/move", { id: "T-001-sa", stage: "plan" });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.ok, false);
    assert.equal((blocked.body as { code: number }).code, 2);
    assert.match(blocked.body.error?.rule ?? "", /question/);
    assert.equal(ticketToml(), before);

    const ans = await call("question/answer", { id: "Q-001-sa", answer: "One card per order." });
    assert.equal(ans.status, 200, JSON.stringify(ans.body));

    const dry = await call("ticket/move", { id: "T-001-sa", stage: "plan" }, { dry_run: true });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(ticketToml(), before, "dry run writes nothing");

    const moved = await call("ticket/move", { id: "T-001-sa", stage: "plan" });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.ok, true);
    assert.match(ticketToml(), /stage = "plan"/);

    const lines = activityLines();
    assert.ok(lines.some((l) => l.verb === "ticket move" && l.code === 0 && l.entity === "T-001-sa"));
    assert.ok(lines.some((l) => l.verb === "ticket move" && l.code === 2));
  });

  test("todo add through the console, then GET /todos", async () => {
    const add = await call("todo/add", { text: "Ask ops for the UAT login", ticket: "T-002-sa" });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const all = await data<TodoList>("/api/v1/todos");
    const mine = all.find((t) => t.text === "Ask ops for the UAT login");
    assert.ok(mine);
    assert.equal(mine.status, "open");
    assert.equal(mine.ticket, "T-002-sa");
    assert.equal(mine.author, "sam");
    assert.equal("schema_version" in mine, false);
    const forTicket = await data<TodoList>("/api/v1/todos?ticket=T-002-sa&status=open");
    assert.ok(forTicket.every((t) => t.ticket === "T-002-sa" && t.status === "open"));
    assert.equal((await app.request("/api/v1/todos?status=maybe")).status, 400);
  });

  test("GET /verbs lists console verbs with fields", async () => {
    const cat = await data<VerbCatalog>("/api/v1/verbs");
    const move = cat.find((v) => v.id === "ticket move");
    assert.ok(move);
    assert.deepEqual(move.args, ["id", "stage"]);
    assert.equal(move.writes, true);
    assert.deepEqual(
      move.fields.map((f) => [f.key, f.kind, f.required]),
      [
        ["id", "string", true],
        ["stage", "string", true],
      ],
    );
    assert.ok(cat.some((v) => v.id === "config set"));
    assert.ok(!cat.some((v) => (v.id as string) === "run" || (v.id as string) === "init"));
  });
});

describe("settings", () => {
  test("view, config set to workspace.toml and workspace.local.toml, bad values refused", async () => {
    const wsBefore = (await toml("workspace.toml")) as Record<string, unknown>;
    let v = await data<SettingsView>("/api/v1/settings");
    assert.deepEqual(
      v.sections.map((s) => s.id),
      ["workspace", "models", "agents", "permissions", "telegram"],
    );
    let dh = settingOf(v, "work-log", "day_hours");
    assert.deepEqual([dh?.section, dh?.value, dh?.source, dh?.field?.type], ["workspace", 8, "default", "number"]);
    assert.equal(settingOf(v, "runtime-claude", "protect")?.section, "permissions");
    assert.equal(settingOf(v, "runtime-cursor", "command")?.field?.scope, "local");
    assert.equal(settingOf(v, "runtimes", "silence_sec")?.section, "agents");

    const set = await call("config/set", { plugin: "work-log", key: "day_hours", value: 7 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    v = await data<SettingsView>("/api/v1/settings");
    dh = settingOf(v, "work-log", "day_hours");
    assert.deepEqual([dh?.value, dh?.source], [7, "workspace.toml"]);
    const wsAfter = (await toml("workspace.toml")) as Record<string, unknown>;
    assert.deepEqual(wsAfter.workspace, wsBefore.workspace);
    assert.deepEqual(wsAfter.layers, wsBefore.layers);
    assert.deepEqual(wsAfter.bundles, wsBefore.bundles);
    assert.deepEqual(wsAfter.plugin, [{ id: "work-log", config: { day_hours: 7 } }]);
    assert.ok(activityLines().some((l) => l.verb === "config set" && l.code === 0));

    // A local-scope key always goes to workspace.local.toml; --local sends a shared key there too.
    const bin = await call("config/set", { plugin: "runtime-claude", key: "command", value: "C:/tools/claude.exe" });
    assert.equal(bin.status, 200, JSON.stringify(bin.body));
    const local = await call("config/set", { plugin: "work-log", key: "day_hours", value: "6.5", local: true });
    assert.equal(local.status, 200, JSON.stringify(local.body));
    const localToml = (await toml("workspace.local.toml")) as { plugin: { id: string; config: Record<string, unknown> }[] };
    assert.deepEqual(
      localToml.plugin.map((r) => [r.id, r.config]),
      [
        ["runtime-claude", { command: "C:/tools/claude.exe" }],
        ["work-log", { day_hours: 6.5 }],
      ],
    );
    v = await data<SettingsView>("/api/v1/settings");
    assert.deepEqual([settingOf(v, "work-log", "day_hours")?.value, settingOf(v, "work-log", "day_hours")?.source], [6.5, "workspace.local.toml"]);

    const dry = await call("config/set", { plugin: "runtimes", key: "silence_sec", value: 900 }, { dry_run: true });
    assert.equal(dry.status, 200);
    assert.equal(settingOf(await data<SettingsView>("/api/v1/settings"), "runtimes", "silence_sec")?.source, "default");

    const textBefore = readFileSync(join(ws.root, "workspace.toml"), "utf8");
    for (const [input, rule] of [
      [{ plugin: "work-log", key: "day_hours", value: "lots" }, "config-bad-value"],
      [{ plugin: "work-log", key: "day_hours", value: 30 }, "config-bad-value"],
      [{ plugin: "runtimes", key: "silence_sec", value: 1.5 }, "config-bad-value"],
      [{ plugin: "runtimes", key: "default_runtime", value: "vim" }, "config-bad-value"],
      [{ plugin: "runtime-claude", key: "protect", value: "maybe" }, "config-bad-value"],
      [{ plugin: "work-log", key: "nope", value: 1 }, "config-unknown-key"],
      [{ plugin: "no-such-plugin", key: "x", value: 1 }, "config-unknown-key"],
    ] as const) {
      const r = await call("config/set", input);
      assert.equal(r.status, 422, JSON.stringify(input));
      assert.equal(r.body.error?.rule, rule, JSON.stringify(input));
    }
    assert.equal(readFileSync(join(ws.root, "workspace.toml"), "utf8"), textBefore);
    assert.equal(existsSync(join(ws.root, "workspace.toml")), true);
  });
});

describe("helpers", () => {
  test("verb id from path", () => {
    assert.equal(verbIdFromPath("/api/v1/verbs/ticket/move"), "ticket move");
    assert.equal(verbIdFromPath("/api/v1/verbs/log-work"), "log-work");
    assert.equal(verbIdFromPath("/api/v1/verbs/ticket%20move"), undefined);
    assert.equal(verbIdFromPath("/api/v1/verbs/ticket//move"), undefined);
  });

  test("write queue runs one at a time", async () => {
    const q = createWriteQueue();
    const order: string[] = [];
    const slow = (n: string, ms: number) => () =>
      new Promise<void>((r) => {
        order.push(`start ${n}`);
        setTimeout(() => {
          order.push(`end ${n}`);
          r();
        }, ms);
      });
    await Promise.all([q(slow("a", 20)), q(async () => Promise.reject(new Error("x"))).catch(() => {}), q(slow("b", 1))]);
    assert.deepEqual(order, ["start a", "end a", "start b", "end b"]);
  });
});
