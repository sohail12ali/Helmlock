import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonc } from "./jsonc.ts";

test("parseJsonc strips line and block comments and trailing commas", () => {
  const text = '﻿// head\n{\n  /* block\n  comment */ "a": 1, // tail\n  "b": [1, 2, ],\n  "c": { "d": true, },\n}\n';
  assert.deepEqual(parseJsonc(text), { a: 1, b: [1, 2], c: { d: true } });
});

test("parseJsonc leaves comment markers, commas and escaped quotes inside strings alone", () => {
  assert.deepEqual(parseJsonc('{ "a": "x // y /* z */ ,]", "q": "say \\"hi\\", }", }'), { a: "x // y /* z */ ,]", q: 'say "hi", }' });
});

test("parseJsonc accepts plain JSON and still rejects broken JSON", () => {
  assert.deepEqual(parseJsonc('{"folders":[{"path":"."}]}'), { folders: [{ path: "." }] });
  assert.throws(() => parseJsonc("{ a: 1 }"), SyntaxError);
});
