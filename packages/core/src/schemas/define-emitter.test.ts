import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineEmitter } from "./define-emitter.ts";

const schema = z.object({ schema_version: z.number() }).loose();

test("defineEmitter returns a frozen emitter", () => {
  const e = defineEmitter({ kind: "k", schema, version: 2, order: { "": ["schema_version"] }, migrations: { 1: (d) => d } });
  assert.equal(e.kind, "k");
  assert.ok(Object.isFrozen(e));
  assert.ok(Object.isFrozen(e.order[""]));
});

test("defineEmitter rejects bad specs", () => {
  assert.throws(() => defineEmitter({ kind: "", schema, version: 1, order: { "": [] } }), /kind/);
  assert.throws(() => defineEmitter({ kind: "k", schema, version: 0, order: { "": [] } }), /version/);
  assert.throws(() => defineEmitter({ kind: "k", schema, version: 1, order: {} }), /order/);
  assert.throws(() => defineEmitter({ kind: "k", schema, version: 1, order: { "": ["a", "a"] } }), /duplicate/);
  assert.throws(() => defineEmitter({ kind: "k", schema, version: 2, order: { "": [] }, migrations: { 2: (d) => d } }), /migration 2/);
});
