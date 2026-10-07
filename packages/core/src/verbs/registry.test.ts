import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { ActivityLine } from "../contracts/schemas.ts";
import type { Services } from "../contracts/services.ts";
import { blocked, ok } from "../contracts/verbs.ts";
import { createKernel } from "../kernel/kernel.ts";
import { describeInput, liteObject } from "./input.ts";
import { createVerbRegistry, defineVerb } from "./registry.ts";
import { didYouMean } from "./suggest.ts";

const actor = { kind: "agent" as const, id: "builder", onBehalfOf: "sam" };
const base = { actor, dryRun: false, json: true, cwd: ".", interactive: false };

function setup() {
  const k = createKernel({ log: () => {} });
  const verbs = createVerbRegistry(k.root);
  k.root.provide("verbs", verbs);
  const lines: Omit<ActivityLine, "ts">[] = [];
  const done: unknown[] = [];
  k.root.on("verb.done", (p) => void done.push(p));
  const withActivity = () =>
    k.root.provide("activity", {
      append: async (l: Omit<ActivityLine, "ts">) => void lines.push(l),
      read: async () => [],
    } as unknown as Services["activity"]);
  verbs.register(
    defineVerb({
      id: "ticket move",
      summary: "move",
      examples: ["hl ticket move T-001-sa plan"],
      args: ["id", "to"],
      input: z.object({ id: z.string(), to: z.string() }),
      writes: true,
      run: async (_v, i) => ok({ id: i.id, stage: i.to }),
    }),
  );
  verbs.register({
    id: "ticket gate",
    summary: "gate",
    examples: ["x"],
    input: z.object({}),
    writes: true,
    run: async () => blocked("gate:blocking-questions", "Q-001-sa is open", { fix: "answer it" }),
  });
  verbs.register({
    id: "boom",
    summary: "throws",
    examples: ["x"],
    input: z.object({}),
    writes: false,
    run: async () => {
      throw Object.assign(new Error("bad file"), { rule: "schema-version", file: "a.toml", fix: "upgrade" });
    },
  });
  return { k, verbs, lines, done, withActivity };
}

test("run validates input first (code 1, bad-input)", async () => {
  const { verbs } = setup();
  const r = await verbs.run("ticket move", { id: 3 }, base);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 1);
    assert.equal(r.error.rule, "bad-input");
    assert.match(r.error.message, /id/);
  }
});

test("a guard deny gives code 2 with rule guard, and a later hook cannot undo it", async () => {
  const { k, verbs } = setup();
  let ran = false;
  k.root.guard("verb/pre-execute", (p) => (p.verb === "ticket move" && p.actor.kind === "agent" ? "agents may not move tickets here" : undefined));
  k.root.hook("verb/pre-execute", (p) => {
    ran = true;
    return p;
  });
  const r = await verbs.run("ticket move", { id: "T-001-sa", to: "plan" }, base);
  assert.deepEqual(r, { ok: false, code: 2, error: { rule: "guard", message: "agents may not move tickets here" } });
  assert.equal(ran, false);
});

test("pre and post hooks can change input and result", async () => {
  const { k, verbs } = setup();
  k.root.hook("verb/pre-execute", (p, next) => next({ ...p, input: { ...p.input, to: "build" } }));
  k.root.hook("verb/post-execute", (p, next) => next({ ...p, result: p.result.ok ? { ...p.result, text: "moved" } : p.result }));
  const r = await verbs.run("ticket move", { id: "T-001-sa", to: "plan" }, base);
  assert.deepEqual(r, { ok: true, data: { id: "T-001-sa", stage: "build" }, text: "moved" });
});

test("writes append an activity line (not in dry run) and every run emits verb.done", async () => {
  const { verbs, lines, done, withActivity } = setup();
  await verbs.run("ticket move", { id: "T-001-sa", to: "plan" }, base);
  assert.equal(lines.length, 0, "no activity service yet: nothing written, nothing thrown");
  withActivity();
  await verbs.run("ticket move", { id: "T-001-sa", to: "plan" }, base);
  await verbs.run("ticket move", { id: "T-001-sa", to: "plan" }, { ...base, dryRun: true });
  await verbs.run("ticket gate", {}, base);
  await verbs.run("boom", {}, base);
  assert.deepEqual(lines, [
    { actor: { kind: "agent", id: "builder" }, on_behalf_of: "sam", verb: "ticket move", code: 0, entity: "T-001-sa" },
    { actor: { kind: "agent", id: "builder" }, on_behalf_of: "sam", verb: "ticket gate", code: 2 },
  ]);
  assert.equal(done.length, 5);
  assert.deepEqual(done[2], { verb: "ticket move", code: 0, actor, dryRun: true, entity: "T-001-sa" });
});

test("thrown errors keep rule, file and fix and map to code 1", async () => {
  const { verbs } = setup();
  const r = await verbs.run("boom", {}, base);
  assert.deepEqual(r, { ok: false, code: 1, error: { rule: "schema-version", message: "bad file", file: "a.toml", fix: "upgrade" } });
});

test("unknown verb suggests close ids", async () => {
  const { verbs } = setup();
  const r = await verbs.run("ticket mvoe", {}, base);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error.message, /Did you mean: ticket move/);
  assert.deepEqual(verbs.suggest("tickt move"), ["ticket move"]);
});

test("duplicate verb registration is an error", () => {
  const { verbs } = setup();
  assert.throws(
    () => verbs.register({ id: "boom", summary: "", examples: ["x"], input: z.object({}), writes: false, run: async () => ok(1) }),
    /already registered/,
  );
});

test("didYouMean ranks by distance and accepts prefixes", () => {
  assert.deepEqual(didYouMean("tikcet lst", ["ticket list", "ticket new", "todo list"]), ["ticket list"]);
  assert.deepEqual(didYouMean("T-014-as", ["T-014-sa", "T-015-sa", "T-200-xx"]), ["T-014-sa"]);
  assert.deepEqual(didYouMean("zzzzzz", ["where"]), []);
  assert.deepEqual(didYouMean("tick", ["ticket list", "where"]), ["ticket list"]);
});

test("describeInput reads zod objects and liteObject", () => {
  const schema = z.object({
    title: z.string(),
    size: z.enum(["S", "M", "L"]).optional(),
    weight: z.number().int().optional(),
    rejected: z.array(z.string()).default([]),
    blocking: z.boolean().default(false),
  });
  assert.deepEqual(describeInput(schema), [
    { key: "title", kind: "string", required: true },
    { key: "size", kind: "string", required: false, choices: ["S", "M", "L"] },
    { key: "weight", kind: "number", required: false },
    { key: "rejected", kind: "array", of: "string", required: false },
    { key: "blocking", kind: "boolean", required: false },
  ]);
  const lite = liteObject({ repair: "boolean" });
  assert.deepEqual(describeInput(lite), [{ key: "repair", kind: "boolean", required: false }]);
  assert.equal(lite.safeParse({ repair: "yes" }).success, false);
  assert.equal(lite.safeParse({ nope: true }).success, false);
  assert.deepEqual(lite.safeParse({ repair: true }), { success: true, data: { repair: true } });
});
