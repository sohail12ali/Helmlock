import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { catalog } from "@helmlock/plugins";
import { z } from "zod";
import type { PluginCatalog } from "../contracts/catalog.ts";
import type { PluginModule } from "../contracts/kernel.ts";
import type { ActivityLine } from "../contracts/schemas.ts";
import type { Services } from "../contracts/services.ts";
import { ok } from "../contracts/verbs.ts";
import { createTestWorkspace, DELIVERY_ROOT, FIXTURES } from "../testing.ts";
import { defineVerb } from "../verbs/registry.ts";
import { createRuntime } from "./runtime.ts";

test("where resolves the fixture workspace", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const res = await ws.run("where");
    assert.ok(res.ok);
    const data = res.data as { author: string; name: string };
    assert.equal(data.author, "sam");
    assert.equal(data.name, "Test");
  } finally {
    await ws.cleanup();
  }
});

test("mountAll mounts every stub plugin", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const results = await ws.runtime.mountAll();
    assert.deepEqual(
      results.filter((r) => r.state === "failed"),
      [],
    );
    assert.equal(results.length, 15);
  } finally {
    await ws.cleanup();
  }
});

// ---------- lazy mounting with a small fake catalog ----------

interface Fake {
  root: string;
  loaded: string[];
  lines: Omit<ActivityLine, "ts">[];
  logs: string[];
  catalog: PluginCatalog;
  cleanup(): void;
}

function fakeWorkspace(workspaceToml: string, local?: string): Fake {
  const root = mkdtempSync(join(tmpdir(), "hl-s1-"));
  cpSync(join(FIXTURES, "ws-min"), root, { recursive: true });
  writeFileSync(join(root, "workspace.toml"), workspaceToml);
  if (local) writeFileSync(join(root, "workspace.local.toml"), local);
  const loaded: string[] = [];
  const lines: Omit<ActivityLine, "ts">[] = [];
  const manifest = (id: string, provides: string[], requires: string[], verbs: string[]) => {
    const dir = join(root, ".plugins", id);
    mkdirSync(dir, { recursive: true });
    const list = (xs: string[]) => `[${xs.map((x) => `"${x}"`).join(", ")}]`;
    writeFileSync(
      join(dir, "plugin.toml"),
      `id = "${id}"\nkind = "code"\nversion = "0.1.0"\nprovides = ${list(provides)}\nrequires = ${list(requires)}\nverbs = ${list(verbs)}\n`,
    );
    return dir;
  };
  const entry = (id: string, provides: string[], requires: string[], verbs: string[], mod: PluginModule) => ({
    dir: manifest(id, provides, requires, verbs),
    load: async () => {
      loaded.push(id);
      return { default: mod };
    },
  });
  const cat: PluginCatalog = {
    provider: entry("provider", ["search"], [], [], {
      name: "provider",
      apply: (ctx) => void ctx.provide("search", { query: async () => [] } as Services["search"]),
    }),
    user: entry("user", [], ["search"], ["thing do"], {
      name: "user",
      requires: ["search"],
      Config: z.object({ greeting: z.string().default("hello") }),
      apply(ctx, cfg) {
        ctx.get("verbs").register(
          defineVerb({
            id: "thing do",
            summary: "do a thing",
            examples: ["hl thing do x"],
            args: ["id"],
            input: z.object({ id: z.string() }),
            writes: true,
            run: async (_v, i) => ok({ id: i.id, greeting: (cfg as { greeting: string }).greeting }),
          }),
        );
      },
    }),
    roster: entry("roster", ["roster"], [], [], { name: "roster", apply() {} }),
    activity: entry("activity", ["activity"], [], [], {
      name: "activity",
      apply: (ctx) =>
        void ctx.provide("activity", { append: async (l: Omit<ActivityLine, "ts">) => void lines.push(l), read: async () => [] } as Services["activity"]),
    }),
    lonely: entry("lonely", [], ["tickets"], ["lonely run"], { name: "lonely", requires: ["tickets"], apply() {} }),
  };
  return { root, loaded, lines, logs: [], catalog: cat, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ROWS = `schema_version = 1
bundles = []
[workspace]
name = "S1"
[[plugin]]
id = "provider"
use = "provider"
[[plugin]]
id = "user"
use = "user"
[plugin.config]
greeting = "hi"
[[plugin]]
id = "roster"
use = "roster"
[[plugin]]
id = "activity"
use = "activity"
[[plugin]]
id = "lonely"
use = "lonely"
`;

test("a verb mounts only its plugin, its providers, and roster+activity for writes", async () => {
  const f = fakeWorkspace(ROWS);
  const rt = await createRuntime({ cwd: f.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog: f.catalog, log: (l) => void f.logs.push(l) });
  try {
    const where = await rt.run("where", {});
    assert.ok(where.ok);
    assert.deepEqual(f.loaded, [], "core verbs load no plugin code");
    const r = await rt.run("thing do", { id: "x-1" });
    assert.deepEqual(r, { ok: true, data: { id: "x-1", greeting: "hi" } });
    assert.deepEqual(f.loaded, ["provider", "user", "roster", "activity"]);
    assert.deepEqual(f.lines, [{ actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "thing do", code: 0, entity: "x-1" }]);
  } finally {
    await rt.dispose();
    f.cleanup();
  }
});

test("a verb whose plugin is pending fails loudly and names what it waits for", async () => {
  const f = fakeWorkspace(ROWS);
  const rt = await createRuntime({ cwd: f.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog: f.catalog, log: (l) => void f.logs.push(l) });
  try {
    const r = await rt.run("lonely run", {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.rule, "plugin-pending");
      assert.match(r.error.message, /waiting for tickets/);
    }
    assert.match(f.logs.join("\n"), /pending plugins: lonely \(waiting for tickets\)/);
  } finally {
    await rt.dispose();
    f.cleanup();
  }
});

test("launch flags and workspace.local.toml reach plugin config; --disable turns a plugin off", async () => {
  const f = fakeWorkspace(ROWS, `[[plugin]]\nid = "user"\n[plugin.config]\ngreeting = "local"\n`);
  const rt = await createRuntime({ cwd: f.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog: f.catalog, flags: { disable: ["roster"] } });
  try {
    const r = await rt.run("thing do", { id: "x" });
    assert.deepEqual(r.ok && r.data, { id: "x", greeting: "local" });
    assert.ok(!f.loaded.includes("roster"));
    const show = await rt.run("config show", {});
    const rows = (show.ok ? (show.data as { rows: { id: string; source: { layer: string } }[] }).rows : []).map((x) => [x.id, x.source.layer]);
    assert.deepEqual(rows, [
      ["provider", "workspace.toml"],
      ["user", "workspace.local.toml"],
      ["roster", "flags"],
      ["activity", "workspace.toml"],
      ["lonely", "workspace.toml"],
    ]);
  } finally {
    await rt.dispose();
    f.cleanup();
  }
});

test("a broken workspace.toml keeps core verbs working and fails plugin verbs closed", async () => {
  const f = fakeWorkspace(`mystery = 1\n${ROWS}`);
  const rt = await createRuntime({ cwd: f.root, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog: f.catalog });
  try {
    assert.ok((await rt.run("where", {})).ok);
    const r = await rt.run("thing do", { id: "x" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error.message, /unknown top-level key "mystery"/);
    assert.deepEqual(f.loaded, []);
    const doc = await rt.run("doctor", {});
    const checks = doc.ok ? (doc.data as { checks: { name: string; status: string }[] }).checks : [];
    assert.equal(checks.find((c) => c.name === "workspace.toml")?.status, "fail");
  } finally {
    await rt.dispose();
    f.cleanup();
  }
});

test("doctor --repair adds per-machine files to .gitignore (dry run writes nothing)", async () => {
  const f = fakeWorkspace(ROWS);
  const rt = await createRuntime({ cwd: f.root, env: { HL_DELIVERY: DELIVERY_ROOT, PATH: "" }, catalog: f.catalog });
  try {
    await rt.run("doctor", { repair: true }, { dryRun: true });
    assert.throws(() => readFileSync(join(f.root, ".gitignore"), "utf8"));
    const r = await rt.run("doctor", { repair: true });
    assert.ok(r.ok);
    assert.deepEqual((r.data as { repaired: string[] }).repaired, ["gitignore"]);
    assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "author.local\nworkspace.local.toml\n.env\n");
    const checks = (r.data as { checks: { name: string; status: string }[] }).checks;
    assert.equal(checks.find((c) => c.name === "git")?.status, "fail", "empty PATH: git not found");
  } finally {
    await rt.dispose();
    f.cleanup();
  }
});
