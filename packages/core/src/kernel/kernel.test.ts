import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginModule } from "../contracts/kernel.ts";
import type { Services } from "../contracts/services.ts";
import { createKernel } from "./kernel.ts";

const actor = { kind: "person" as const, id: "sam", onBehalfOf: "sam" };
const quiet = () => createKernel({ log: () => {} });
const fake = <K extends keyof Services>(_k: K, v: object = {}) => v as unknown as Services[K];

test("hooks run by priority, ties break by plugin name, not load order", async () => {
  const k = quiet();
  const order: string[] = [];
  const mk = (name: string, priority: number): PluginModule => ({
    name,
    apply(ctx) {
      ctx.hook(
        "verb/pre-execute",
        async (p, next) => {
          order.push(name);
          return next(p);
        },
        { priority },
      );
    },
  });
  await k.mount("zeta", mk("zeta", 5));
  await k.mount("low", mk("low", 1));
  await k.mount("alpha", mk("alpha", 5));
  await k.mount("high", mk("high", 10));
  await k.root.runHook("verb/pre-execute", { verb: "x", input: {}, actor, dryRun: false });
  assert.deepEqual(order, ["high", "alpha", "zeta", "low"]);
  await k.dispose();
});

test("waterfall: a handler may change the payload or veto the rest", async () => {
  const k = quiet();
  k.root.hook("verb/pre-execute", (p, next) => next({ ...p, verb: "changed" }), { priority: 2 });
  k.root.hook("verb/pre-execute", (p) => ({ ...p, dryRun: true }), { priority: 1 });
  let reached = false;
  k.root.hook("verb/pre-execute", (p) => {
    reached = true;
    return p;
  });
  const out = await k.root.runHook("verb/pre-execute", { verb: "x", input: {}, actor, dryRun: false });
  assert.equal(out.verb, "changed");
  assert.equal(out.dryRun, true);
  assert.equal(reached, false);
  await k.dispose();
});

test("guard deny cannot be undone by a later hook", async () => {
  const k = quiet();
  await k.mount("gate", { name: "gate", apply: (ctx) => void ctx.guard("approval/request", () => "pushes are blocked") });
  await k.mount("yes", {
    name: "yes",
    apply: (ctx) => void ctx.hook("approval/request", (p) => ({ ...p, decision: "allow" }), { priority: 100 }),
  });
  const payload = { action: "git push", detail: "", actor };
  const after = await k.root.runHook("approval/request", payload);
  assert.equal(after.decision, "allow");
  // Guards are read separately from the hook result; they apply from any scope.
  assert.deepEqual(await k.root.checkGuards("approval/request", after), ["pushes are blocked"]);
  assert.deepEqual(await k.root.child("other").checkGuards("approval/request", after), ["pushes are blocked"]);
  await k.unmount("gate");
  assert.deepEqual(await k.root.checkGuards("approval/request", payload), []);
  await k.dispose();
});

test("disposers run in reverse order, children before parents", async () => {
  const k = quiet();
  const log: string[] = [];
  await k.mount("a", {
    name: "a",
    async apply(ctx) {
      await ctx.effect(() => () => void log.push("a1"));
      const c = ctx.child("a-child");
      await c.effect(() => () => void log.push("a-child"));
      await ctx.effect(() => () => void log.push("a2"));
    },
  });
  await k.mount("b", { name: "b", apply: async (ctx) => void (await ctx.effect(() => () => void log.push("b"))) });
  await k.dispose();
  assert.deepEqual(log, ["b", "a2", "a-child", "a1"]);
});

test("a disposer is idempotent and unlinks itself", async () => {
  const k = quiet();
  let n = 0;
  const d = await k.root.effect(() => () => void n++);
  await d();
  await d();
  await k.dispose();
  assert.equal(n, 1);
});

test("pending -> active when a provider appears", async () => {
  const k = quiet();
  let applied = 0;
  const r = await k.mount("tickets", { name: "tickets", requires: ["workflow"], apply: () => void applied++ });
  assert.equal(r.state, "pending");
  assert.deepEqual(r.waitingFor, ["workflow"]);
  assert.deepEqual(k.pending(), [{ id: "tickets", waitingFor: ["workflow"] }]);
  await k.mount("wf", { name: "wf", apply: (ctx) => void ctx.provide("workflow", fake("workflow")) });
  assert.equal(applied, 1);
  assert.deepEqual(k.pending(), []);
  await k.dispose();
});

test("a provider registered directly on root also releases pending plugins", async () => {
  const k = quiet();
  await k.mount("t", { name: "t", requires: ["search"], apply() {} });
  k.root.provide("search", fake("search"));
  await k.settled();
  assert.deepEqual(k.states(), [{ id: "t", state: "active" }]);
  await k.dispose();
});

test("restart when the provider is swapped", async () => {
  const k = quiet();
  const seen: string[] = [];
  const provider = (tag: string): PluginModule => ({ name: tag, apply: (ctx) => void ctx.provide("search", fake("search", { tag })) });
  await k.mount("p1", provider("one"));
  await k.mount("dep", {
    name: "dep",
    requires: ["search"],
    async apply(ctx) {
      seen.push(`up:${(ctx.get("search") as unknown as { tag: string }).tag}`);
      await ctx.effect(() => () => void seen.push("down"));
    },
  });
  await k.unmount("p1");
  assert.deepEqual(k.pending(), [{ id: "dep", waitingFor: ["search"] }]);
  await k.mount("p2", provider("two"));
  assert.deepEqual(seen, ["up:one", "down", "up:two"]);
  await k.dispose();
});

test("a failing plugin is isolated and its partial registrations are undone", async () => {
  const k = quiet();
  const bad = await k.mount("bad", {
    name: "bad",
    apply(ctx) {
      ctx.provide("search", fake("search"));
      throw new Error("boom");
    },
  });
  assert.equal(bad.state, "failed");
  assert.equal(bad.error, "boom");
  assert.equal(k.root.has("search"), false);
  const good = await k.mount("good", { name: "good", apply: (ctx) => void ctx.provide("skills", fake("skills")) });
  assert.equal(good.state, "active");
  assert.equal(k.root.has("skills"), true);
  await k.dispose();
});

test("config is validated by the plugin's Config schema", async () => {
  const k = quiet();
  const bad = await k.mount("c", {
    name: "c",
    Config: {
      parse: () =>
        ((): never => {
          throw new Error("bad config");
        })(),
    } as never,
    apply() {},
  });
  assert.equal(bad.state, "failed");
  await k.dispose();
});

test("a second provider for one key is an error", async () => {
  const k = quiet();
  await k.mount("a", { name: "a", apply: (ctx) => void ctx.provide("search", fake("search")) });
  const b = await k.mount("b", { name: "b", apply: (ctx) => void ctx.provide("search", fake("search")) });
  assert.equal(b.state, "failed");
  assert.match(b.error ?? "", /already provided: search \(by a\)/);
  assert.throws(() => k.root.provide("search", fake("search")), /already provided/);
  await k.dispose();
});

test("get on a missing service throws pending service", () => {
  const k = quiet();
  assert.throws(() => k.root.get("tickets"), /pending service: tickets/);
});

test("events are observe-only: a failing listener never reaches the emitter", async () => {
  const lines: string[] = [];
  const k = createKernel({ log: (l) => void lines.push(l) });
  let got = 0;
  k.root.on("verb.done", () => {
    throw new Error("listener broke");
  });
  k.root.on("verb.done", () => void got++);
  await k.root.emit("verb.done", { verb: "x", code: 0, actor, dryRun: false });
  assert.equal(got, 1);
  assert.match(lines.join("\n"), /listener broke/);
  await k.dispose();
});

test("a throwing guard denies (fail-closed)", async () => {
  const k = quiet();
  k.root.guard("verb/pre-execute", () => {
    throw new Error("x");
  });
  const r = await k.root.checkGuards("verb/pre-execute", { verb: "v", input: {}, actor, dryRun: false });
  assert.equal(r.length, 1);
  await k.dispose();
});
