import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parse } from "smol-toml";
import { parseToml } from "./file-layer.ts";
import { emitToml, formatKey, formatString } from "./toml-writer.ts";

describe("toml writer", () => {
  test("strings are TOML-escaped and parse back unchanged", () => {
    const s = 'quote " back \\ nl \n tab \t cr \r bell \u0007 del \u007f unicode é ☕ 𝄞';
    const text = emitToml({ s }, { "": ["s"] });
    assert.equal(parse(text).s, s);
    assert.equal(formatString("a\u0001b"), '"a\\u0001b"');
  });

  test("keys are bare when possible, quoted otherwise", () => {
    assert.equal(formatKey("ok_key-1"), "ok_key-1");
    assert.equal(formatKey("has space"), '"has space"');
    assert.equal(formatKey("dot.ted"), '"dot.ted"');
  });

  test("ints and floats keep their kind; specials are written", () => {
    const text = emitToml({ i: 3, f: 1.5, big: 2n ** 60n, nan: Number.NaN, inf: Number.POSITIVE_INFINITY, ninf: Number.NEGATIVE_INFINITY }, { "": [] });
    assert.equal(text, "i = 3\nf = 1.5\nbig = 1152921504606846976\nnan = nan\ninf = inf\nninf = -inf\n");
    assert.equal(emitToml({ f: 2 }, { "": [] }, { floats: new Set(["f"]) }), "f = 2.0\n");
  });

  test("hinted dates are written bare only while still valid dates", () => {
    const hints = { dates: new Set(["d", "e"]) };
    assert.equal(emitToml({ d: "2026-09-17", e: "not a date" }, { "": [] }, hints), 'd = 2026-09-17\ne = "not a date"\n');
  });

  test("unknown keys follow known keys in original order; null and undefined are dropped", () => {
    const text = emitToml({ z: 1, b: 2, a: 3, gone: undefined, nul: null, y: 4 }, { "": ["a", "b"] });
    assert.equal(text, "a = 3\nb = 2\nz = 1\ny = 4\n");
  });

  test("root scalars, then tables, then arrays of tables; deeper nesting goes inline", () => {
    const data = {
      rows: [{ n: 1, sub: { deep: { x: 1 }, list: [{ a: 1 }] } }, { n: 2 }],
      t: { k: "v" },
      empty_tables: [],
      empty_list: [],
      version: 1,
    };
    const text = emitToml(data, { "": ["version", "t", "rows"], rows: ["n"], empty_tables: [] });
    assert.equal(
      text,
      [
        "version = 1",
        "empty_list = []",
        "",
        "[t]",
        'k = "v"',
        "",
        "[[rows]]",
        "n = 1",
        "",
        "[rows.sub]",
        "deep = { x = 1 }",
        "list = [{ a = 1 }]",
        "",
        "[[rows]]",
        "n = 2",
        "",
      ].join("\n"),
    );
    const back = JSON.parse(JSON.stringify(parse(text))) as Record<string, unknown>;
    assert.deepEqual(back.rows, [{ n: 1, sub: { deep: { x: 1 }, list: [{ a: 1 }] } }, { n: 2 }]);
  });

  test("an empty object is an empty table header", () => {
    assert.equal(emitToml({ a: 1, t: {} }, { "": [] }), "a = 1\n\n[t]\n");
  });

  test("parseToml keeps integers as numbers and notes integer-valued floats and dates", () => {
    const p = parseToml("a = 2\nb = 2.0\nc = 2026-01-02\n[[t]]\nx = 1.0\n");
    assert.deepEqual(p.data, { a: 2, b: 2, c: "2026-01-02", t: [{ x: 1 }] });
    assert.deepEqual(
      [...p.floats].map((s) => s.split("\u0001").join(".")),
      ["b", "t.0.x"],
    );
    assert.deepEqual([...p.dates], ["c"]);
  });
});
