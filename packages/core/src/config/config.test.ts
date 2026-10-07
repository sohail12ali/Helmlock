import assert from "node:assert/strict";
import { test } from "node:test";
import { composeRows, validateWorkspaceToml } from "./config.ts";

const ws = (extra: Record<string, unknown> = {}) => ({ schema_version: 1, workspace: { name: "T" }, ...extra });

test("bundle rows come first and record their source", () => {
  const { rows } = composeRows({ workspace: ws() });
  assert.equal(rows.length, 16);
  assert.deepEqual(rows[0], { id: "roster", use: "roster", source: { layer: "bundle", file: "delivery-lite" } });
});

test("layer order: bundle -> workspace.toml -> workspace.local.toml -> flags, last layer wins and is recorded", () => {
  const { rows } = composeRows({
    workspace: ws({
      plugin: [
        { id: "search", config: { limit: 10, mode: "rg", nested: { a: 1, b: 1 } } },
        { id: "voice", use: "voice-web-speech", config: { read_aloud: false } },
      ],
    }),
    local: { plugin: [{ id: "search", config: { limit: 20, nested: { b: 2 } } }] },
    flags: { "plugin.search.limit": "30", "plugin.voice.read_aloud": "true", disable: ["harness"] },
  });
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.get("search"), {
    id: "search",
    use: "search",
    config: { limit: 30, mode: "rg", nested: { a: 1, b: 2 } },
    source: { layer: "flags", file: "launch flags" },
  });
  assert.deepEqual(by.get("voice")?.config, { read_aloud: true });
  assert.equal(by.get("harness")?.disabled, true);
  assert.deepEqual(by.get("roster")?.source, { layer: "bundle", file: "delivery-lite" });
});

test("a row from workspace.local.toml is recorded with its layer", () => {
  const { rows } = composeRows({ workspace: ws(), local: { plugin: [{ id: "todos", disabled: true }] } });
  const r = rows.find((x) => x.id === "todos");
  assert.equal(r?.disabled, true);
  assert.deepEqual(r?.source, { layer: "workspace.local.toml", file: "workspace.local.toml" });
});

test("use swaps the plugin behind an id and drops the old config", () => {
  const { rows } = composeRows({
    workspace: ws({ plugin: [{ id: "workflow-lite", config: { x: 1 } }] }),
    local: { plugin: [{ id: "workflow-lite", use: "workflow-mine" }] },
  });
  const r = rows.find((x) => x.id === "workflow-lite");
  assert.equal(r?.use, "workflow-mine");
  assert.equal(r?.config, undefined);
});

test("an unknown id without use is an error", () => {
  assert.throws(() => composeRows({ workspace: ws({ plugin: [{ id: "nope", config: {} }] }) }), /id "nope" patches a row that does not exist/);
  assert.throws(() => composeRows({ workspace: ws(), flags: { disable: "ghost" } }), /ghost/);
  assert.throws(() => composeRows({ workspace: ws(), flags: { "plugin.ghost.x": "1" } }), /ghost/);
});

test("unknown top-level keys in workspace.toml are refused (F105)", () => {
  assert.throws(() => composeRows({ workspace: ws({ plugins: [] }) }), /unknown top-level key "plugins"/);
  assert.throws(() => composeRows({ workspace: ws(), local: { workspace: {} } }), /workspace.local.toml: unknown top-level key "workspace"/);
});

test("unknown bundle is an error", () => {
  assert.throws(() => composeRows({ workspace: ws({ bundles: ["nope"] }) }), /unknown bundle "nope"/);
});

test("schema validation of workspace.toml is available lazily", async () => {
  assert.deepEqual(await validateWorkspaceToml(ws()), []);
  assert.notDeepEqual(await validateWorkspaceToml({ workspace: {} }), []);
});
