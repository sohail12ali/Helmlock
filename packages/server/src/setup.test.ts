// Onboarding v2 (Blueprint 34): GET /setup/detect, POST /setup/test-engine (hello probe classification with fake
// adapters), POST /setup/you, POST /setup/upkeep and the shared step list. No agent CLI runs: the engines are fakes.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type {
  ApiResponse,
  PluginCatalog,
  PluginModule,
  RunEvent,
  RunHandle,
  RuntimeAdapter,
  RuntimesService,
  SetupDetect,
  SetupEngineTest,
  SetupStatus,
  SetupUpkeep,
  SetupYouResult,
} from "@helmlock/core";
import { WRITE_HEADER } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { fakeRunManager } from "@helmlock/plugins/crew/crew-fakes.ts";
import { setupText } from "@helmlock/plugins/settings/setup-status.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { classifyHello, redactLine, suggestIdentity } from "./setup.ts";

const W = { "content-type": "application/json", [WRITE_HEADER]: "1" };

// ---------- fake engines ----------

type Script = { events: RunEvent[]; done: { ok: boolean; exitCode: number | null; timedOut: boolean }; hang?: boolean };
function handle(s: Script): RunHandle {
  let cancelled = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    id: "r-hello",
    events: {
      async *[Symbol.asyncIterator]() {
        for (const e of s.events) yield e;
        if (s.hang && !cancelled) await gate;
      },
    },
    async cancel() {
      cancelled = true;
      release();
    },
    done: s.hang ? gate.then(() => ({ ok: false, exitCode: null, timedOut: true })) : Promise.resolve(s.done),
  };
}
const engine = (id: string, script: Script | null, o: Partial<RuntimeAdapter> = {}): RuntimeAdapter => ({
  id,
  label: id === "cursor" ? "Cursor" : "Claude Code",
  detect: async () => (script ? { command: `/bin/${id}`, version: "2.1.0 (Claude Code)" } : null),
  start: async () => handle(script as Script),
  ...o,
});
const OK: Script = {
  events: [
    { type: "init", sessionId: "s1" },
    { type: "text", text: "hello" },
    { type: "result", ok: true, text: "hello" },
  ],
  done: { ok: true, exitCode: 0, timedOut: false },
};
const fail = (text: string, failureClass?: string): Script => ({
  events: [{ type: "result", ok: false, text, ...(failureClass ? { failureClass } : {}) }],
  done: { ok: false, exitCode: 1, timedOut: false },
});

const adapters = new Map<string, RuntimeAdapter>();
const runtimesSvc: RuntimesService = {
  register(a) {
    adapters.set(a.id, a);
    return () => {
      adapters.delete(a.id);
    };
  },
  get: (id) => adapters.get(id),
  list: () => [...adapters.values()],
};
const noop: PluginModule = { name: "noop", apply() {} };
const entry = (id: string, mod: PluginModule) => ({ dir: (catalog[id] as { dir: string }).dir, load: async () => ({ default: mod }) });
const testCatalog: PluginCatalog = {
  ...catalog,
  runtimes: entry("runtimes", {
    name: "runtimes",
    apply(ctx) {
      ctx.provide("runtimes", runtimesSvc);
      ctx.provide("runManager", fakeRunManager());
    },
  }),
  "runtime-claude": entry("runtime-claude", noop),
  "runtime-cursor": entry("runtime-cursor", noop),
};

// ---------- fake local model server ----------

let local: Server;
let localUrl = "";
let ws: TestWorkspace;
let app: Hono;
let outside: string;
const gitConfig: Record<string, string> = { "user.name": "Ann Lee", "user.email": "ann@example.com" };

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, headers: W, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
const dataOf = <T>(r: { status: number; body: ApiResponse<T> }): T => {
  assert.ok(r.body.ok, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
};

before(async () => {
  local = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/v1/models" ? JSON.stringify({ data: [{ id: "qwen3-14b" }, { id: "gemma-3" }] }) : "{}");
  });
  await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
  localUrl = `http://127.0.0.1:${(local.address() as AddressInfo).port}/v1`;
  // A closed port: the probe must give up quickly and list nothing.
  const closed = createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/v1`;
  await new Promise<void>((r) => closed.close(() => r()));

  adapters.set("claude-code", engine("claude-code", OK));
  adapters.set("cursor", engine("cursor", null));
  ws = await createTestWorkspace({ catalog: testCatalog, fixture: "ws-demo" });
  outside = mkdtempSync(join(tmpdir(), "hl-setup-"));
  mkdirSync(join(outside, "wms-api"));
  writeFileSync(
    join(ws.root, "Test.code-workspace"),
    JSON.stringify({
      folders: [
        { name: "knowledge", path: "." },
        { name: "system", path: ws.runtime.info.deliveryRoot },
        { name: "wms-api", path: join(outside, "wms-api") },
        { name: "web", path: join(outside, "web") },
      ],
    }),
  );
  mkdirSync(join(ws.root, "projects", "web"), { recursive: true });
  writeFileSync(join(ws.root, "projects", "web", "project.toml"), 'schema_version = 1\n\n[project]\nid = "web"\nname = "Web"\nrepos = ["web"]\n');
  writeFileSync(join(ws.root, ".env"), "OPENAI_API_KEY=sk-from-dotenv-never-shown\n");
  app = createApp(ws.runtime, {
    log: () => {},
    setup: {
      helloTimeoutSec: 1,
      detect: {
        env: { OPENROUTER_API_KEY: "sk-or-secret-value" },
        git: (k) => gitConfig[k],
        local: [
          { preset: "lmstudio", base_url: localUrl },
          { preset: "ollama", base_url: deadUrl },
        ],
        timeoutMs: 600,
      },
    },
  });
});
after(async () => {
  await ws.cleanup();
  await new Promise<void>((r) => local.close(() => r()));
  rmSync(outside, { recursive: true, force: true });
});

describe("pure helpers", () => {
  test("suggestIdentity: slug and initials from the git name, avoiding taken ones", () => {
    assert.deepEqual(suggestIdentity("Ann Lee", { ids: [], initials: [] }), { slug: "ann", initials: "al" });
    assert.deepEqual(suggestIdentity("Ann Lee", { ids: ["ann"], initials: ["al"] }), { slug: "ann-l", initials: "ale" });
    assert.deepEqual(suggestIdentity("José", { ids: [], initials: [] }), { slug: "jose", initials: "jo" });
    assert.deepEqual(suggestIdentity("  ", { ids: [], initials: [] }), {});
  });

  test("classifyHello: ok, login required, usage limited, timed out, failed", () => {
    assert.equal(classifyHello({ ok: true, timedOut: false, exitCode: 0, text: "hello" }), "ok");
    assert.equal(classifyHello({ ok: false, timedOut: false, exitCode: 1, failureClass: "auth_required" }), "login_required");
    assert.equal(classifyHello({ ok: false, timedOut: false, exitCode: 1, text: "Invalid API key · Please run /login" }), "login_required");
    assert.equal(classifyHello({ ok: false, timedOut: false, exitCode: 1, text: "Claude usage limit reached" }), "usage_limited");
    assert.equal(classifyHello({ ok: false, timedOut: false, exitCode: 1, failureClass: "transient_upstream" }), "usage_limited");
    assert.equal(classifyHello({ ok: false, timedOut: true, exitCode: null }), "timed_out");
    assert.equal(classifyHello({ ok: false, timedOut: false, exitCode: 2, text: "boom" }), "failed");
  });

  test("redactLine: first line only, keys hidden, short", () => {
    assert.equal(redactLine("\n  hello there\nsecond"), "hello there");
    assert.equal(redactLine("bad key sk-ant-api03-abcdefghijklmnop rejected"), "bad key [hidden] rejected");
    assert.equal(redactLine("x".repeat(300)).length <= 120, true);
  });
});

describe("GET /setup/detect", () => {
  test("git identity is a suggestion; the author is known", async () => {
    const d = dataOf(await call<SetupDetect>("GET", "/api/v1/setup/detect"));
    assert.equal(d.you.git_name, "Ann Lee");
    assert.equal(d.you.git_email, "ann@example.com");
    assert.equal(d.you.suggested_slug, "ann");
    assert.equal(d.you.suggested_initials, "al");
    assert.equal(d.you.author, "sam");
    assert.equal(d.you.author_known, true);
    assert.deepEqual(d.you.person, { id: "sam", name: "Sam Abbott" });
    assert.equal(d.you.match, undefined);
  });

  test("engines, provider candidates by key name or a running local server, folders not yet projects", async () => {
    const r = await call<SetupDetect>("GET", "/api/v1/setup/detect");
    const d = dataOf(r);
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes("sk-or-secret-value") && !raw.includes("sk-from-dotenv"), "never a key value");
    const claude = d.engines.find((e) => e.id === "claude-code");
    assert.equal(claude?.found, true);
    assert.equal(claude?.version, "2.1.0 (Claude Code)");
    assert.equal(d.engines.find((e) => e.id === "cursor")?.found, false);
    const byPreset = new Map(d.providers.candidates.map((c) => [c.preset, c]));
    assert.deepEqual(byPreset.get("openrouter"), {
      preset: "openrouter",
      label: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      key_env: "OPENROUTER_API_KEY",
      source: "environment",
    });
    assert.equal(byPreset.get("openai")?.source, ".env");
    assert.deepEqual(byPreset.get("lmstudio")?.models, ["qwen3-14b", "gemma-3"]);
    assert.equal(byPreset.get("lmstudio")?.source, "running");
    assert.equal(byPreset.has("ollama"), false, "a local server that does not answer is not offered");
    assert.deepEqual(d.folders, [{ name: "wms-api", path: join(outside, "wms-api") }]);
    assert.ok(d.projects.some((p) => p.id === "web"));
  });
});

describe("POST /setup/test-engine", () => {
  const run = async (engineId: string) => dataOf(await call<SetupEngineTest>("POST", "/api/v1/setup/test-engine", { engine: engineId }));
  const codes = (t: SetupEngineTest) => t.checks.map((c) => c.code);

  test("needs the write header", async () => {
    const res = await app.request("/api/v1/setup/test-engine", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403);
  });

  test("ok: found, then the hello probe answers; the result shows up in detect", async () => {
    const t = await run("claude-code");
    assert.equal(t.ok, true);
    assert.deepEqual(codes(t), ["cli_found", "hello_ok"]);
    assert.match(t.checks[1]!.message, /answered in .*"hello"/);
    const d = dataOf(await call<SetupDetect>("GET", "/api/v1/setup/detect"));
    assert.equal(d.engines.find((e) => e.id === "claude-code")?.last?.ok, true);
  });

  test("not found", async () => {
    const t = await run("cursor");
    assert.equal(t.ok, false);
    assert.deepEqual(codes(t), ["cli_not_found"]);
    assert.match(t.checks[0]!.hint ?? "", /cursor\.com\/cli/);
  });

  test("login required, usage limited, timed out, failed; output redacted", async () => {
    adapters.set("cursor", engine("cursor", fail("Authentication required: please run cursor-agent login", "auth_required")));
    let t = await run("cursor");
    assert.deepEqual(codes(t), ["cli_found", "login_required"]);
    assert.equal(t.ok, false);
    assert.match(t.checks[1]!.hint ?? "", /cursor-agent login/);

    adapters.set("claude-code", engine("claude-code", fail("Claude usage limit reached. Your limit resets at 5pm")));
    t = await run("claude-code");
    assert.deepEqual(codes(t), ["cli_found", "usage_limited"]);
    assert.equal(t.ok, true, "a usage limit warns: the CLI is signed in");

    adapters.set("claude-code", engine("claude-code", { events: [], done: { ok: false, exitCode: null, timedOut: true }, hang: true }));
    t = await run("claude-code");
    assert.deepEqual(codes(t), ["cli_found", "hello_timeout"]);
    assert.equal(t.checks[1]!.level, "warn");

    adapters.set("claude-code", engine("claude-code", fail("boom with token sk-abcdefghijklmnopqrstuvwxyz\nsecond line secret")));
    t = await run("claude-code");
    assert.deepEqual(codes(t), ["cli_found", "hello_failed"]);
    assert.ok(!JSON.stringify(t).includes("sk-abcdefghij") && !JSON.stringify(t).includes("second line"));
    adapters.set("claude-code", engine("claude-code", OK));
  });

  test("an unknown engine", async () => {
    const t = await run("codex");
    assert.deepEqual(codes(t), ["engine_unknown"]);
  });
});

describe("setup steps", () => {
  test("GET /setup and hl setup show the same list", async () => {
    const s = dataOf(await call<SetupStatus>("GET", "/api/v1/setup"));
    assert.deepEqual(
      s.steps.map((x) => x.id),
      ["you", "engine", "code", "crew", "phone", "first-task"],
    );
    const by = new Map(s.steps.map((x) => [x.id, x]));
    assert.equal(by.get("you")?.done, true);
    assert.equal(by.get("engine")?.done, true, by.get("engine")?.detail ?? "");
    assert.match(by.get("engine")?.detail ?? "", /Claude Code/);
    assert.equal(by.get("code")?.optional, true);
    const cli = await ws.run("setup", {}, { json: true });
    assert.ok(cli.ok);
    assert.deepEqual(
      (cli.data as SetupStatus).steps.map((x) => [x.id, x.done]),
      s.steps.map((x) => [x.id, x.done]),
    );
    assert.match(setupText(s), /\[x\] You: Sam Abbott \(sam\)/);
  });
});

describe("POST /setup/upkeep", () => {
  test("repairs silently, reports only failures", async () => {
    writeFileSync(join(ws.root, ".gitignore"), "node_modules\n");
    const u = dataOf(await call<SetupUpkeep>("POST", "/api/v1/setup/upkeep", {}));
    assert.deepEqual(u.failures, []);
    assert.ok(u.repaired.some((r) => r.startsWith("gitignore")));
    assert.match(readFileSync(join(ws.root, ".gitignore"), "utf8"), /^author\.local$/m);
  });
});

describe("POST /setup/you", () => {
  test("refused while a valid author is set", async () => {
    const r = await call<SetupYouResult>("POST", "/api/v1/setup/you", { id: "ann", name: "Ann Lee", initials: "al" });
    assert.equal(r.status, 409);
  });

  test("adds the person, claims the git spellings, writes author.local", async () => {
    unlinkSync(join(ws.root, "author.local"));
    (ws.runtime.info as { author: string | undefined }).author = undefined;
    const bad = await call<SetupYouResult>("POST", "/api/v1/setup/you", { id: "Ann Lee" });
    assert.equal(bad.status, 400);
    const r = dataOf(
      await call<SetupYouResult>("POST", "/api/v1/setup/you", {
        id: "ann",
        name: "Ann Lee",
        initials: "al",
        email: "ann@example.com",
        git: ["Ann Lee", "ann@example.com"],
      }),
    );
    assert.deepEqual(r, { person: { id: "ann", name: "Ann Lee", initials: "al" }, created: true, claimed: ["Ann Lee", "ann@example.com"] });
    assert.equal(readFileSync(join(ws.root, "author.local"), "utf8").trim(), "ann");
    assert.match(readFileSync(join(ws.root, "people.toml"), "utf8"), /id = "ann"/);
    const d = dataOf(await call<SetupDetect>("GET", "/api/v1/setup/detect"));
    assert.equal(d.you.author_known, true);
    assert.deepEqual(d.you.match, { id: "ann", name: "Ann Lee" });
  });
});
