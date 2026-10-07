import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createFileLayer, loadConfig, type PluginManifest } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";
import { buildSettingsView, coerceValue, type SettingDecl, setInDoc, settingsOf } from "./settings.ts";

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

test("config set from the CLI: text values, --local, --dry-run, refusals", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const file = join(ws.root, "workspace.toml");
    const before = readFileSync(file, "utf8");

    const dry = await ws.run("config set", { plugin: "work-log", key: "day_hours", value: "7" }, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.equal(readFileSync(file, "utf8"), before);

    const r = await ws.run("config set", { plugin: "work-log", key: "day_hours", value: "7" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.text ?? "", /set work-log\.day_hours = 7 in workspace\.toml/);
    const after = plain(parse(readFileSync(file, "utf8"))) as Record<string, unknown>;
    assert.equal((after.workspace as { name: string }).name, "Test");
    assert.equal((after.layers as unknown[]).length, 2);
    assert.deepEqual(after.plugin, [{ id: "work-log", config: { day_hours: 7 } }]);

    // A second key on the same row patches that row; nothing else moves.
    const p = await ws.run("config set", { plugin: "runtime-claude", key: "protect", value: "false" });
    assert.ok(p.ok, JSON.stringify(p));
    const again = await ws.run("config set", { plugin: "work-log", key: "day_hours", value: "7.5" });
    assert.ok(again.ok);
    assert.deepEqual((plain(parse(readFileSync(file, "utf8"))) as { plugin: unknown }).plugin, [
      { id: "work-log", config: { day_hours: 7.5 } },
      { id: "runtime-claude", config: { protect: false } },
    ]);

    const local = await ws.run("config set", { plugin: "runtimes", key: "default_runtime", value: "cursor", local: true });
    assert.ok(local.ok, JSON.stringify(local));
    const lt = plain(parse(readFileSync(join(ws.root, "workspace.local.toml"), "utf8"))) as Record<string, unknown>;
    assert.deepEqual(lt.plugin, [{ id: "runtimes", config: { default_runtime: "cursor" } }]);
    assert.equal(lt.schema_version, 1);

    const unknown = await ws.run("config set", { plugin: "work-log", key: "colour", value: "x" });
    assert.equal(unknown.ok, false);
    assert.equal(!unknown.ok && unknown.error.rule, "config-unknown-key");
    assert.match(!unknown.ok ? (unknown.error.fix ?? "") : "", /day_hours/);
    const bad = await ws.run("config set", { plugin: "work-log", key: "day_hours", value: "-1" });
    assert.equal(!bad.ok && bad.error.rule, "config-bad-value");

    // The next config load composes the new values (config reload, no re-mount needed).
    const cfg = await loadConfig(createFileLayer(ws.root));
    assert.equal(cfg.pluginConfig("work-log").day_hours, 7.5);
    assert.equal(cfg.pluginConfig("runtimes").default_runtime, "cursor");
  } finally {
    await ws.cleanup();
  }
});

test("list settings: comma-separated text or an array becomes a TOML array (telegram allowed_user_ids)", async () => {
  const d: SettingDecl = { key: "ids", type: "list", label: "Ids", scope: "local", section: "telegram" };
  assert.deepEqual(coerceValue("x", d, " 1, 2 ,,3 "), ["1", "2", "3"]);
  assert.deepEqual(coerceValue("x", d, [5, "6"]), ["5", "6"]);
  assert.deepEqual(coerceValue("x", d, ""), []);
  assert.throws(() => coerceValue("x", d, true), /expected a list/);
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const r = await ws.run("config set", { plugin: "telegram", key: "allowed_user_ids", value: "4242, 77" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.text ?? "", /telegram\.allowed_user_ids = \["4242","77"\] in workspace\.local\.toml/);
    const lt = plain(parse(readFileSync(join(ws.root, "workspace.local.toml"), "utf8"))) as { plugin: unknown };
    assert.deepEqual(lt.plugin, [{ id: "telegram", config: { allowed_user_ids: ["4242", "77"] } }]);
    const fromConsole = await ws.run("config set", { plugin: "telegram", key: "allowed_user_ids", value: [1, "2"] });
    assert.ok(fromConsole.ok, JSON.stringify(fromConsole));
    const cfg = await loadConfig(createFileLayer(ws.root));
    assert.deepEqual(cfg.pluginConfig("telegram").allowed_user_ids, ["1", "2"]);
  } finally {
    await ws.cleanup();
  }
});

test("settings declarations and coercion", () => {
  const m = {
    id: "x",
    settings: { a: { type: "bool", label: "A" }, b: { type: "colour" }, c: { type: "select" }, k: { type: "secret-env", section: "models" } },
  };
  const problems: string[] = [];
  const decls = settingsOf(m as unknown as PluginManifest, problems);
  assert.deepEqual(
    decls.map((d) => [d.key, d.type, d.scope, d.section]),
    [
      ["a", "boolean", "workspace", "workspace"],
      ["k", "secret-env", "workspace", "models"],
    ],
  );
  assert.equal(problems.length, 2);
  const k = decls[1] as SettingDecl;
  assert.equal(coerceValue("x", k, "OPENROUTER_API_KEY"), "OPENROUTER_API_KEY");
  assert.throws(() => coerceValue("x", k, "sk-or-v1-abc"), /NAME of an environment variable/);
  assert.equal(coerceValue("x", decls[0] as SettingDecl, "true"), true);
});

test("settings view: sections, defaults and sources", () => {
  const manifests = new Map(
    Object.entries({
      "work-log": { id: "work-log", settings: { day_hours: { type: "number", default: 8, label: "Day" } } },
      roster: { id: "roster" },
    }) as [string, PluginManifest][],
  );
  const workspace = {
    schema_version: 1,
    workspace: { name: "T" },
    bundles: [] as string[],
    plugin: [
      { id: "work-log", use: "work-log" },
      { id: "roster", use: "roster" },
    ],
  };
  let v = buildSettingsView({ manifests, workspace });
  assert.equal(v.sections.length, 5);
  assert.deepEqual(v.sections[0]?.plugins[0]?.values.day_hours, { value: 8, source: "default" });
  assert.equal(v.sections[0]?.plugins.length, 1);
  v = buildSettingsView({ manifests, workspace, local: setInDoc({ schema_version: 1 }, "work-log", "day_hours", 6) });
  assert.deepEqual(v.sections[0]?.plugins[0]?.values.day_hours, { value: 6, source: "workspace.local.toml" });
});

test("provider add appends a provider and model row and sets the default model; refuses a key instead of an env name", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const r = await ws.run("provider add", { id: "local", preset: "ollama", model: "llama3.1" });
    assert.ok(r.ok, JSON.stringify(r));
    const toml = readFileSync(join(ws.root, "workspace.toml"), "utf8");
    assert.match(toml, /base_url = "http:\/\/localhost:11434\/v1"/);
    assert.match(toml, /default_model = "local\/llama3.1"/);
    const again = await ws.run("provider add", { id: "local", preset: "ollama", model: "x" });
    assert.equal(again.ok, false);
    const slashed = await ws.run("provider add", { id: "lms", preset: "lmstudio", model: "google/gemma-4-12b-qat" });
    assert.ok(slashed.ok, JSON.stringify(slashed));
    assert.match(readFileSync(join(ws.root, "workspace.toml"), "utf8"), /id = "lms\/google\/gemma-4-12b-qat"/);
    const key = await ws.run("provider add", { id: "oa", preset: "openai", key_env: "sk-abc123", model: "gpt" });
    assert.equal(key.ok, false);
  } finally {
    await ws.cleanup();
  }
});
