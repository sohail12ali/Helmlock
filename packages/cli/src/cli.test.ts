import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { FieldInfo } from "@helmlock/core";
import { splitGlobals } from "./args.ts";
import { buildLeaf, parseLeaf } from "./leaf.ts";

const DELIVERY = resolve(import.meta.dirname, "../../..");
const HL = join(DELIVERY, "packages", "cli", "bin", "hl.ts");
const WS = join(DELIVERY, "test", "fixtures", "ws-min");

function hl(...args: string[]) {
  const r = spawnSync(process.execPath, [HL, ...args], {
    cwd: WS,
    env: { ...process.env, HL_DELIVERY: DELIVERY, NO_COLOR: "1" },
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("hl where --json prints the envelope", () => {
  const r = hl("where", "--json");
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.data.author, "sam");
  assert.equal(out.data.name, "Test");
  assert.equal(out.data.sources.deliveryRoot, "HL_DELIVERY");
});

test("unknown command: did you mean, exit 1", () => {
  const r = hl("tikcet", "lst");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown command: tikcet lst\. Did you mean: hl ticket list\?/);
  const j = hl("wehre", "--json");
  assert.equal(j.code, 1);
  const out = JSON.parse(j.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.rule, "unknown-command");
  assert.match(out.error.message, /hl where/);
});

test("hl help agent prints the agent contract", () => {
  const r = hl("help", "agent");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /state through hl, prose directly/);
  assert.match(r.stdout, /2 {2}blocked by a gate/);
  assert.ok(r.stdout.split("\n").length <= 40);
});

test("hl doctor --json lists checks", () => {
  const r = hl("doctor", "--json");
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  const names = out.data.checks.map((c: { name: string }) => c.name);
  for (const n of ["node", "pnpm", "git", "workspace", "workspace.toml", "plugins", "author"]) assert.ok(names.includes(n), n);
  assert.equal(out.data.checks.find((c: { name: string }) => c.name === "workspace").status, "pass");
});

test("--help on a verb shows its examples; hl --help lists nouns", () => {
  const v = hl("doctor", "--help");
  assert.equal(v.code, 0);
  assert.match(v.stdout, /--repair/);
  assert.match(v.stdout, /Examples:\n {2}hl doctor/);
  const top = hl("--help");
  assert.equal(top.code, 0);
  assert.match(top.stdout, /ticket\s+.*move/);
});

test("bad flag on a verb: exit 1 with the rule", () => {
  const r = hl("where", "--bogus", "--json");
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).error.rule, "bad-args");
});

test("config show --json reports layers", () => {
  const r = hl("config", "show", "--json", "--disable", "harness");
  assert.equal(r.code, 0, r.stderr);
  const rows = JSON.parse(r.stdout).data.rows as { id: string; disabled?: boolean; source: { layer: string } }[];
  const harness = rows.find((x) => x.id === "harness");
  assert.equal(harness?.disabled, true);
  assert.equal(harness?.source.layer, "flags");
});

// ---------- argument mapping (no spawn) ----------

test("globals are taken out; config flags are collected", () => {
  const g = splitGlobals(["ticket", "move", "T-1", "--json", "--plugin.search.limit=5", "--disable", "harness,skills", "--dry-run", "plan"]);
  assert.equal(g.json, true);
  assert.equal(g.dryRun, true);
  assert.deepEqual(g.rest, ["ticket", "move", "T-1", "plan"]);
  assert.deepEqual(g.configFlags, { "plugin.search.limit": "5", disable: ["harness", "skills"] });
});

// Fields as describeInput (core, tested there) returns them for a zod object.
const DECISION_FIELDS: FieldInfo[] = [
  { key: "ticket", kind: "string", required: true },
  { key: "title", kind: "string", required: true },
  { key: "chosen", kind: "string", required: false },
  { key: "rejected", kind: "array", of: "string", required: false },
  { key: "weight", kind: "number", required: false },
  { key: "blocking", kind: "boolean", required: false },
  { key: "next_action", kind: "string", required: false },
];
const decision = {
  id: "decision add",
  summary: "add a decision",
  examples: ['hl decision add T-001-sa "Use TOML"'],
  args: ["ticket", "title"],
  repeatable: ["rejected"],
};
const leaf = () => buildLeaf(decision, DECISION_FIELDS);

test("positional args, --some-flag -> some_flag, repeatable -> arrays, numbers", () => {
  const p = parseLeaf(leaf(), [
    "T-001-sa",
    "Use TOML",
    "--chosen",
    "toml",
    "--rejected",
    "yaml",
    "--rejected",
    "json",
    "--weight",
    "3",
    "--blocking",
    "--next-action",
    "ship",
  ]);
  assert.deepEqual(p.input, {
    ticket: "T-001-sa",
    title: "Use TOML",
    chosen: "toml",
    rejected: ["yaml", "json"],
    weight: 3,
    blocking: true,
    next_action: "ship",
  });
  assert.deepEqual(p.missing, []);
  assert.deepEqual(
    parseLeaf(leaf(), ["T-001-sa"]).missing.map((f) => f.key),
    ["title"],
  );
  assert.throws(() => parseLeaf(leaf(), ["a", "b", "c"]), /too many arguments/);
  assert.throws(() => parseLeaf(leaf(), ["a", "b", "--chosn", "x"]), /unknown option/);
});

test("a trailing ...rest collects the remainder", () => {
  const fields: FieldInfo[] = [
    { key: "ticket", kind: "string", required: true },
    { key: "words", kind: "array", of: "string", required: true },
  ];
  const p = parseLeaf(buildLeaf({ id: "log-work", summary: "", examples: ["x"], args: ["ticket", "...words"] }, fields), ["T-1", "did", "the", "thing"]);
  assert.deepEqual(p.input, { ticket: "T-1", words: ["did", "the", "thing"] });
});
