import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

const providersCfg = (root: string) => {
  const doc = plain(parse(readFileSync(join(root, "workspace.toml"), "utf8"))) as { plugin: { id: string; config?: Record<string, unknown> }[] };
  return (doc.plugin.filter((r) => r.id === "providers").at(-1)?.config ?? {}) as {
    providers?: { id: string; key_env?: string }[];
    models?: { id: string; provider: string; label: string; context_window?: number; tool_calls?: boolean; vision?: boolean }[];
    default_model?: string;
    assistant_model?: string;
  };
};

test("provider add saves several models with their probe info; the default stays the first saved", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const r = await ws.run("provider add", {
      id: "lms",
      preset: "lmstudio",
      models: ["google/gemma-4-12b-qat", "spark-x2.5-4b", "lms/spark-x2.5-4b"],
      model_info: [
        { id: "google/gemma-4-12b-qat", context_window: 262144, tool_calls: true, vision: true },
        { id: "spark-x2.5-4b", context_window: 1048576, tool_calls: true, vision: false },
      ],
    });
    assert.ok(r.ok, JSON.stringify(r));
    let c = providersCfg(ws.root);
    assert.deepEqual(
      c.models?.map((m) => [m.id, m.label, m.context_window, m.vision]),
      [
        ["lms/google/gemma-4-12b-qat", "google/gemma-4-12b-qat", 262144, true],
        ["lms/spark-x2.5-4b", "spark-x2.5-4b", 1048576, false],
      ],
    );
    assert.equal(c.default_model, "lms/google/gemma-4-12b-qat");
    // A second provider keeps the default; an existing provider id points at model add.
    const or = await ws.run("provider add", { id: "openrouter", preset: "openrouter", key_env: "OPENROUTER_API_KEY", models: ["openai/gpt-4.1-mini"] });
    assert.ok(or.ok, JSON.stringify(or));
    c = providersCfg(ws.root);
    assert.equal(c.default_model, "lms/google/gemma-4-12b-qat");
    assert.equal(c.providers?.length, 2);
    const dup = await ws.run("provider add", { id: "lms", preset: "lmstudio", models: ["x"] });
    assert.equal(!dup.ok && dup.error.rule, "config-bad-value");
    assert.match(!dup.ok ? (dup.error.fix ?? "") : "", /hl model add lms/);
    const none = await ws.run("provider add", { id: "empty", preset: "ollama" });
    assert.equal(none.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("model add, model default, model remove and provider remove; dry runs write nothing", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const file = join(ws.root, "workspace.toml");
    assert.ok((await ws.run("provider add", { id: "local", preset: "ollama", model: "llama3.1" })).ok);
    assert.ok((await ws.run("provider add", { id: "or", preset: "openrouter", key_env: "OPENROUTER_API_KEY", models: ["a/one"] })).ok);
    const role = await ws.run("config set", { plugin: "providers", key: "assistant_model", value: "or/a/one" });
    assert.ok(role.ok, JSON.stringify(role));

    // model add: several at once, existing ones skipped and named, unknown provider refused.
    let before = readFileSync(file, "utf8");
    const dryAdd = await ws.run("model add", { provider: "or", models: ["b/two"] }, { dryRun: true });
    assert.ok(dryAdd.ok, JSON.stringify(dryAdd));
    assert.equal(readFileSync(file, "utf8"), before);
    const add = await ws.run("model add", { provider: "or", models: ["b/two", "or/a/one", "c/three"], model_info: [{ id: "c/three", vision: true }] });
    assert.ok(add.ok, JSON.stringify(add));
    assert.match(add.text ?? "", /added or\/b\/two, or\/c\/three; already there: or\/a\/one/);
    assert.deepEqual(
      providersCfg(ws.root).models?.map((m) => m.id),
      ["local/llama3.1", "or/a/one", "or/b/two", "or/c/three"],
    );
    assert.equal(providersCfg(ws.root).models?.at(-1)?.vision, true);
    const nope = await ws.run("model add", { provider: "ghost", models: ["x"] });
    assert.equal(!nope.ok && nope.error.rule, "config-bad-value");
    assert.match(!nope.ok ? (nope.error.fix ?? "") : "", /known providers: local, or/);

    // model default: must exist; dry run writes nothing.
    before = readFileSync(file, "utf8");
    assert.ok((await ws.run("model default", { id: "or/b/two" }, { dryRun: true })).ok);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal((await ws.run("model default", { id: "or/zzz" })).ok, false);
    const def = await ws.run("model default", { id: "or/b/two" });
    assert.ok(def.ok, JSON.stringify(def));
    assert.equal(providersCfg(ws.root).default_model, "or/b/two");

    // model list marks the default.
    const list = await ws.run("model list", {});
    assert.ok(list.ok, JSON.stringify(list));
    const rows = (list.data as { models: { id: string; default: boolean }[] }).models;
    assert.deepEqual(
      rows.filter((m) => m.default).map((m) => m.id),
      ["or/b/two"],
    );
    assert.match(list.text ?? "", /\* or\/b\/two/);

    // model remove: the default needs --default naming another configured model; a role model is cleared.
    const refuse = await ws.run("model remove", { id: "or/b/two" });
    assert.equal(refuse.ok, false);
    assert.match(!refuse.ok ? (refuse.error.fix ?? "") : "", /--default <id>/);
    assert.equal((await ws.run("model remove", { id: "or/b/two", default: "or/b/two" })).ok, false);
    assert.equal((await ws.run("model remove", { id: "or/b/two", default: "nope/x" })).ok, false);
    before = readFileSync(file, "utf8");
    assert.ok((await ws.run("model remove", { id: "or/a/one" }, { dryRun: true })).ok);
    assert.equal(readFileSync(file, "utf8"), before);
    const rm = await ws.run("model remove", { id: "or/a/one" });
    assert.ok(rm.ok, JSON.stringify(rm));
    assert.match(rm.text ?? "", /cleared assistant_model/);
    assert.equal(providersCfg(ws.root).assistant_model, undefined);
    const rmDef = await ws.run("model remove", { id: "or/b/two", default: "local/llama3.1" });
    assert.ok(rmDef.ok, JSON.stringify(rmDef));
    assert.equal(providersCfg(ws.root).default_model, "local/llama3.1");

    // provider remove: refuses to take the default without --force; --force moves it to the first remaining model.
    const pr = await ws.run("provider remove", { id: "local" });
    assert.equal(pr.ok, false);
    assert.match(!pr.ok ? (pr.error.fix ?? "") : "", /--force/);
    before = readFileSync(file, "utf8");
    assert.ok((await ws.run("provider remove", { id: "local", force: true }, { dryRun: true })).ok);
    assert.equal(readFileSync(file, "utf8"), before);
    const forced = await ws.run("provider remove", { id: "local", force: true });
    assert.ok(forced.ok, JSON.stringify(forced));
    assert.match(forced.text ?? "", /moved to or\/c\/three/);
    let c = providersCfg(ws.root);
    assert.deepEqual(
      c.providers?.map((p) => p.id),
      ["or"],
    );
    assert.equal(c.default_model, "or/c/three");
    // Removing a provider that does not hold the default needs no --force; the last one with --force clears it.
    assert.ok((await ws.run("provider add", { id: "two", preset: "ollama", model: "m" })).ok);
    assert.ok((await ws.run("provider remove", { id: "two" })).ok);
    const last = await ws.run("provider remove", { id: "or", force: true });
    assert.ok(last.ok, JSON.stringify(last));
    assert.match(last.text ?? "", /cleared \(none left\)/);
    c = providersCfg(ws.root);
    assert.equal(c.default_model, undefined);
    assert.deepEqual(c.models, []);
    assert.equal((await ws.run("provider remove", { id: "or" })).ok, false);
  } finally {
    await ws.cleanup();
  }
});
