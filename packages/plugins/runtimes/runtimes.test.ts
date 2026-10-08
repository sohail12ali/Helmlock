import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createTestWorkspace, FIXTURES } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { classify } from "./failures.ts";
import { globToRegExp } from "./glob.ts";
import { guardProtected, protectedGlobs } from "./protect.ts";
import type { RunRecord } from "./run-verb.ts";

const FAKE = join(FIXTURES, "s5-fake", process.platform === "win32" ? "fake-agent.cmd" : "fake-agent");
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
before(() => {
  setEnv("HL_CLAUDE_BIN", FAKE);
  setEnv("HL_CURSOR_BIN", FAKE);
});
after(() => {
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
});

test("globs: ** spans folders, * stays in one segment", () => {
  assert.ok(globToRegExp("artifacts/**/ticket.toml").test("artifacts/T-1/ticket.toml"));
  assert.ok(globToRegExp("artifacts/**/ticket.toml").test("artifacts/ticket.toml"));
  assert.ok(globToRegExp("logs/**").test("logs/2026-10/x.toml"));
  assert.ok(!globToRegExp("projects/*/project.toml").test("projects/a/b/project.toml"));
  assert.ok(!globToRegExp("workspace.toml").test("x/workspace.toml"));
});

test("classify: success, auth, transient, lost process, refusal", () => {
  assert.equal(classify({ subtype: "success", is_error: false, result: "unauthorized is just a word here" }, 0).class, "");
  assert.equal(classify({ subtype: "error", is_error: true, result: "Not logged in. Please run /login" }, 1).class, "auth_required");
  assert.equal(classify({ subtype: "error", is_error: true, api_error_status: 529, result: "x" }, 1).class, "transient_upstream");
  assert.equal(classify(undefined, 1, "boom").class, "process_lost");
  assert.equal(classify({ subtype: "success", stop_reason: "refusal" }, 0).class, "refusal");
  assert.equal(classify({ subtype: "error", is_error: true, result: "weird" }, 1).retryable, false);
});

test("protected guard reports a state file written outside hl, but not one explained by an hl activity line", async () => {
  const root = mkdtempSync(join(tmpdir(), "hl-protect-"));
  try {
    mkdirSync(join(root, "artifacts", "T-001-sa"), { recursive: true });
    mkdirSync(join(root, "artifacts", "T-002-sa"), { recursive: true });
    mkdirSync(join(root, "activity", "2026-10"), { recursive: true });
    writeFileSync(join(root, "artifacts", "T-001-sa", "ticket.toml"), 'stage = "plan"\n');
    writeFileSync(join(root, "activity", "2026-10", "07.sam.jsonl"), "");
    const g = await guardProtected(root);
    writeFileSync(join(root, "artifacts", "T-001-sa", "ticket.toml"), 'stage = "done"\n');
    writeFileSync(join(root, "artifacts", "T-002-sa", "ticket.toml"), 'stage = "build"\n');
    writeFileSync(join(root, "artifacts", "T-002-sa", "notes.md"), "prose is fine\n");
    writeFileSync(join(root, "activity", "2026-10", "07.sam.jsonl"), `${JSON.stringify({ ts: "t", verb: "ticket move", entity: "T-002-sa", code: 0 })}\n`);
    assert.deepEqual(await g.check(), ["artifacts/T-001-sa/ticket.toml"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protectedGlobs is the defaults plus permissions.deny from every layer", () => {
  const root = mkdtempSync(join(tmpdir(), "hl-pg-"));
  try {
    assert.ok(protectedGlobs([root]).includes("workspace.toml"));
    mkdirSync(join(root, "harness"));
    writeFileSync(join(root, "harness", "harness.toml"), '[permissions]\ndeny = ["state/**", "Edit(x.toml)"]\n');
    const globs = protectedGlobs([root]);
    assert.ok(globs.includes("state/**") && globs.includes("x.toml"));
    assert.ok(globs.includes("artifacts/**/ticket.toml"), "an empty or partial workspace deny list never removes the defaults");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hl run: streams, writes a run record, emits run events, runs the pre-run hook", async () => {
  const ws = await createTestWorkspace({ catalog });
  const outs: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  try {
    setEnv("FAKE_MODE", "echo");
    await ws.runtime.mountForVerb("run");
    const seen: string[] = [];
    ws.runtime.ctx.on("run.started", (e) => void seen.push(`started:${e.runtime}`));
    ws.runtime.ctx.on("run.finished", (e) => void seen.push(`finished:${e.ok}`));
    ws.runtime.ctx.hook("agent/pre-run", (p, next) => next({ ...p, prompt: `${p.prompt}\n(from hook)` }));
    process.stdout.write = ((s: string) => {
      outs.push(String(s));
      return true;
    }) as typeof process.stdout.write;
    const res = await ws.run("run", { task: ["Say", "hi"], ticket: "T-001-sa", agent: "builder" }, { json: true });
    process.stdout.write = origWrite;
    assert.ok(res.ok, JSON.stringify(res));
    const rec = res.data as RunRecord;
    assert.equal(rec.mode, "plan");
    assert.equal(rec.runtime, "claude-code");
    assert.equal(rec.ticket, "T-001-sa");
    assert.equal(rec.ok, true);
    assert.equal(rec.session_id, "11111111-2222-3333-4444-555555555555");
    assert.equal(rec.first_result_line, "Say hi");
    assert.deepEqual(seen, ["started:claude-code", "finished:true"]);
    const onDisk = JSON.parse(readFileSync(join(ws.root, "runs", `${rec.id}.json`), "utf8")) as RunRecord;
    assert.equal(onDisk.id, rec.id);
    assert.equal(readFileSync(join(ws.root, "runs", ".gitignore"), "utf8"), "*\n");
    const lines = outs
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text?: string; run: string });
    assert.ok(lines.every((l) => l.run === rec.id));
    assert.ok(lines.some((l) => l.type === "text" && l.text === "PROMPT<<Say hi\n(from hook)>>"));
  } finally {
    process.stdout.write = origWrite;
    setEnv("FAKE_MODE", undefined);
    await ws.cleanup();
  }
});

test("hl run --dry-run spawns nothing and shows the options; an unknown runtime fails", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const dry = await ws.run("run", { task: "x", runtime: "cursor", mode: "force" }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal((dry.data as { runtime: string }).runtime, "cursor");
    const bad = await ws.run("run", { task: "x", runtime: "nope" });
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.error.rule, "unknown-runtime");
    const badMode = await ws.run("run", { task: "x", mode: "default" });
    assert.equal(badMode.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("hl run --runtime cursor: a protected file written by the agent fails the run with protected-path-write", async () => {
  const ws = await createTestWorkspace({ catalog });
  const origWrite = process.stdout.write.bind(process.stdout);
  try {
    setEnv("FAKE_MODE", "write");
    setEnv("FAKE_WRITE", join(ws.root, "artifacts", "T-009-sa", "ticket.toml"));
    process.stdout.write = (() => true) as typeof process.stdout.write;
    const res = await ws.run("run", { task: "move the ticket", runtime: "cursor", mode: "force" });
    process.stdout.write = origWrite;
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.error.rule, "run:protected-path-write");
    assert.match(!res.ok ? res.error.message : "", /artifacts\/T-009-sa\/ticket\.toml/);
    const runs = (await ws.runtime.ctx.get("files").list("runs/*.json")).filter((f) => !f.endsWith(".gitignore"));
    const rec = JSON.parse(readFileSync(join(ws.root, runs[0] as string), "utf8")) as RunRecord;
    assert.equal(rec.failure_class, "protected-path-write");
    assert.equal(rec.runtime, "cursor");
  } finally {
    process.stdout.write = origWrite;
    setEnv("FAKE_MODE", undefined);
    setEnv("FAKE_WRITE", undefined);
    await ws.cleanup();
  }
});
