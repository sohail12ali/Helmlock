// Milestone 1 end to end: a fresh knowledge repo driven only through the hl CLI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

const DELIVERY = resolve(import.meta.dirname, "../..");
const HL = join(DELIVERY, "packages", "cli", "bin", "hl.ts");
let base = "";
let ws = "";

interface Out {
  code: number;
  json: { ok: boolean; code?: number; data?: Record<string, unknown>; error?: { rule: string; message: string } };
  stderr: string;
}

function hl(args: string[], cwd = ws): Out {
  const env = { ...process.env };
  delete env.HL_DELIVERY;
  delete env.HL_WORKSPACE;
  const r = spawnSync(process.execPath, [HL, ...args, "--json"], { cwd, env, encoding: "utf8" });
  let json: Out["json"] = { ok: false };
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = { ok: false, error: { rule: "no-json", message: r.stdout } };
  }
  return { code: r.status ?? -1, json, stderr: r.stderr };
}

before(() => {
  base = mkdtempSync(join(tmpdir(), "hl-e2e-"));
  ws = join(base, "acme-knowledge");
  const r = hl(["init", ws, "--name", "Acme", "--author", "Sam Abbott", "--initials", "sa", "--email", "sam@example.com", "--yes"], base);
  assert.equal(r.code, 0, `${r.stderr}\n${JSON.stringify(r.json)}`);
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("init already generated the host config with the system layer; check is clean", () => {
  const settings = join(ws, ".claude", "settings.json");
  assert.ok(existsSync(settings), "settings.json written by init");
  const text = readFileSync(settings, "utf8");
  assert.ok(text.includes("Edit(artifacts/**/ticket.toml)"), "system deny rules merged in");
  assert.ok(text.includes("Read(author.local)"), "workspace deny_read merged in");
  const committed = spawnSync("git", ["ls-files", ".claude/settings.json", ".cursor/rules/helmlock.mdc"], { cwd: ws, encoding: "utf8" }).stdout;
  assert.match(committed, /\.claude\/settings\.json/, "in the first commit");
  const check = hl(["harness", "sync", "--check"]);
  assert.equal(check.code, 0, `${check.stderr}\n${JSON.stringify(check.json)}`);
});

test("where resolves the new knowledge center", () => {
  const r = hl(["where"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.data?.name, "Acme");
  assert.equal(r.json.data?.author, "sam-abbott");
});

test("doctor reports no failed checks", () => {
  const r = hl(["doctor"]);
  assert.equal(r.code, 0, r.stderr);
  const s = r.json.data?.summary as { fail: number };
  assert.equal(s.fail, 0, JSON.stringify(r.json.data?.checks, null, 1));
});

test("ticket flow with a blocking gate", () => {
  assert.equal(hl(["ticket", "new", "Gift cards", "--size", "M"]).code, 0);
  assert.equal(hl(["ticket", "move", "T-001-sa", "spec"]).code, 0);
  assert.equal(hl(["question", "add", "T-001-sa", "Which currencies?", "--blocking"]).code, 0);
  writeFileSync(join(ws, "artifacts", "T-001-sa", "T-001-sa-spec.md"), "# Spec\n\n**AC-1** Given a card, when redeemed, then the balance drops.\n");
  const blocked = hl(["ticket", "move", "T-001-sa", "plan"]);
  assert.equal(blocked.code, 2);
  assert.equal(blocked.json.error?.rule, "gate:no-blocking-questions");
  assert.equal(hl(["question", "answer", "Q-001-sa", "USD and EUR"]).code, 0);
  assert.equal(hl(["ticket", "move", "T-001-sa", "plan"]).code, 0);
  assert.equal(hl(["task", "add", "T-001-sa", "Redeem endpoint", "--slice", "S1", "--layer", "api", "--ac", "AC-1"]).code, 0);
  assert.equal(hl(["ticket", "claim", "T-001-sa"]).code, 0);
});

test("work log writes once and skips a near duplicate", () => {
  const a = hl(["log-work", "T-001-sa", "Drafted the gift card spec with the team", "--weight", "3"]);
  assert.equal(a.code, 0, a.stderr);
  const b = hl(["log-work", "T-001-sa", "Drafted gift card spec with the team", "--weight", "3"]);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.data?.written, false);
  const month = readdirSync(join(ws, "logs")).find((d) => /^\d{4}-\d{2}$/.test(d));
  assert.ok(month);
});

test("writes leave one activity file per person per day", () => {
  const months = readdirSync(join(ws, "activity")).filter((d) => /^\d{4}-\d{2}$/.test(d));
  assert.equal(months.length, 1);
  const files = readdirSync(join(ws, "activity", months[0] as string)).filter((f) => f.endsWith(".jsonl"));
  assert.equal(files.length, 1);
  const lines = readFileSync(join(ws, "activity", months[0] as string, files[0] as string), "utf8")
    .trim()
    .split("\n");
  assert.ok(lines.length >= 6, `${lines.length} lines`);
});

test("context, validate, search and skills", () => {
  const c = hl(["context", "T-001-sa"]);
  assert.equal(c.code, 0, c.stderr);
  const t = c.json.data?.ticket as { stage: string } | undefined;
  assert.equal(t?.stage, "plan");
  assert.equal(hl(["validate"]).code, 0);
  assert.equal(hl(["validate", "--changed", "artifacts/T-001-sa/T-001-sa-spec.md"]).code, 0);
  const s = hl(["search", "currencies"]);
  assert.equal(s.code, 0);
  const f = hl(["skill", "find", "write a spec"]);
  assert.equal(f.code, 0, f.stderr);
  const top = (f.json.data as unknown as { name: string }[] | { skills: { name: string }[] }) ?? [];
  const names = Array.isArray(top) ? top.map((x) => x.name) : top.skills.map((x) => x.name);
  assert.equal(names[0], "spec");
});

test("harness sync writes host config and check is clean afterwards", () => {
  const s = hl(["harness", "sync"]);
  assert.equal(s.code, 0, `${s.stderr}\n${JSON.stringify(s.json)}`);
  assert.ok(existsSync(join(ws, ".claude", "settings.json")));
  assert.equal(hl(["harness", "sync", "--check"]).code, 0);
});
