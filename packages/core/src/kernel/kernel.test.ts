import assert from "node:assert/strict";
import { test } from "node:test";
import { createKernel } from "./kernel.ts";

test("hooks run by priority and guards only deny", async () => {
  const k = createKernel();
  const order: string[] = [];
  k.root.hook(
    "verb/pre-execute",
    async (p, next) => {
      order.push("low");
      return next(p);
    },
    { priority: 1 },
  );
  k.root.hook(
    "verb/pre-execute",
    async (p, next) => {
      order.push("high");
      return next(p);
    },
    { priority: 10 },
  );
  const actor = { kind: "person" as const, id: "sam", onBehalfOf: "sam" };
  await k.root.runHook("verb/pre-execute", { verb: "x", input: {}, actor, dryRun: false });
  assert.deepEqual(order, ["high", "low"]);
  k.root.guard("approval/request", () => "nope");
  assert.deepEqual(await k.root.checkGuards("approval/request", { action: "push", detail: "", actor }), ["nope"]);
  await k.dispose();
});
