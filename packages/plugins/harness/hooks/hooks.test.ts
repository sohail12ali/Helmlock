import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURES } from "@helmlock/core/testing";
import { isForeign } from "./common.ts";
import { decide, findingsFrom, segments } from "./logic.ts";

const HOOKS = import.meta.dirname;
const POLICY = join(FIXTURES, "s5-harness", "harness", "harness.toml");

function hook(script: string, args: string[], payload: unknown, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, script), ...args], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HL_HOOK_HL: join(FIXTURES, "s5-fake", "fake-hl.mjs"), CLAUDE_PROJECT_DIR: "", ...env },
    timeout: 30000,
  });
  const out = r.stdout.trim();
  return { code: r.status, json: out ? (JSON.parse(out) as Record<string, unknown>) : undefined, stderr: r.stderr };
}
const cwd = join(FIXTURES, "s5-harness");

test("session-start: Claude additionalContext, Cursor additional_context, silent for the other host's payload", () => {
  const c = hook("session-start.ts", ["--host", "claude", "--", "context", "--session"], { hook_event_name: "SessionStart", cwd });
  assert.deepEqual(c.json, { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "In flight: T-001-sa (build)" } });
  const k = hook("session-start.ts", ["--host", "cursor", "--", "context", "--session"], {
    hook_event_name: "sessionStart",
    workspace_roots: [cwd],
    cursor_version: "1",
  });
  assert.deepEqual(k.json, { additional_context: "In flight: T-001-sa (build)" });
  const dup = hook("session-start.ts", ["--host", "claude", "--", "context", "--session"], { hook_event_name: "sessionStart", cursor_version: "1" });
  assert.equal(dup.json, undefined, "Cursor running the Claude hook: ignored, so it fires once");
});

test("post-edit: errors exit 2 on Claude with the message on stderr, followup on Cursor, warnings pass", () => {
  const c = hook("post-edit.ts", ["--host", "claude", "--", "validate", "--changed"], {
    hook_event_name: "PostToolUse",
    cwd,
    tool_input: { file_path: "artifacts/T-1/bad/ticket.toml" },
  });
  assert.equal(c.code, 2);
  assert.match(c.stderr, /\[layout:ticket-folder\] ticket\.toml edited by hand \(fix: use hl ticket move\)/);
  const k = hook("post-edit.ts", ["--host", "cursor", "--", "validate", "--changed"], {
    hook_event_name: "afterFileEdit",
    workspace_roots: [cwd],
    file_path: "x/bad.md",
  });
  assert.equal(k.code, 0);
  assert.match(String(k.json?.followup_message), /ticket\.toml edited by hand/);
  assert.equal(hook("post-edit.ts", ["--host", "claude"], { hook_event_name: "PostToolUse", cwd, tool_input: { file_path: "warn.md" } }).code, 0);
  assert.equal(hook("post-edit.ts", ["--host", "claude"], { hook_event_name: "PostToolUse", cwd, tool_input: { file_path: "ok.md" } }).json, undefined);
});

test("hooks never crash: bad stdin or a missing hl gives exit 0 and no output", () => {
  for (const s of ["session-start.ts", "post-edit.ts", "stop.ts"]) {
    const r = hook(s, ["--host", "claude"], "{not json", {});
    assert.equal(r.code, 0, s);
    assert.equal(r.json, undefined, s);
  }
  const r = hook("post-edit.ts", ["--host", "claude"], { cwd, tool_input: { file_path: "bad.md" } }, { HL_HOOK_HL: join(FIXTURES, "nope.mjs") });
  assert.equal(r.code, 0);
});

test("stop: one-shot reminder with the harness text and today's log, quiet on repeat or when the turn changed nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-stop-"));
  try {
    const wrote = join(dir, "wrote.jsonl");
    const logged = join(dir, "logged.jsonl");
    const read = join(dir, "read.jsonl");
    writeFileSync(wrote, `${JSON.stringify({ message: { content: [{ type: "tool_use", name: "Edit" }] } })}\n`);
    writeFileSync(
      logged,
      `${JSON.stringify({
        message: {
          content: [
            { type: "tool_use", name: "Edit" },
            { type: "tool_use", name: "Bash", input: { command: "hl log-work - x" } },
          ],
        },
      })}\n`,
    );
    writeFileSync(read, `${JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read" }] } })}\n`);
    const args = ["--host", "claude", "--policy", POLICY, "--", "log", "show"];
    const c = hook("stop.ts", args, { hook_event_name: "Stop", cwd, transcript_path: wrote });
    assert.equal(c.json?.decision, "block");
    assert.match(String(c.json?.reason), /^If this session shipped work, log it once with \/log-work\.\n\nLogged so far today:\n2026-10-07 sam: one line$/);
    assert.equal(hook("stop.ts", args, { hook_event_name: "Stop", cwd, transcript_path: wrote, stop_hook_active: true }).json, undefined);
    assert.equal(hook("stop.ts", args, { hook_event_name: "Stop", cwd, transcript_path: logged }).json, undefined);
    assert.equal(hook("stop.ts", args, { hook_event_name: "Stop", cwd, transcript_path: read }).json, undefined);
    const k = hook("stop.ts", ["--host", "cursor", "--policy", POLICY], {
      hook_event_name: "stop",
      status: "completed",
      loop_count: 0,
      workspace_roots: [cwd],
    });
    assert.match(String(k.json?.followup_message), /log it once/);
    assert.equal(hook("stop.ts", ["--host", "cursor", "--policy", POLICY], { hook_event_name: "stop", loop_count: 1 }).json, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pretool: ask, deny, allow per harness.toml; fails closed on any internal error", () => {
  const ask = hook("pretool.ts", ["--host", "cursor", "--policy", POLICY], {
    hook_event_name: "beforeShellExecution",
    command: "cd x && git push origin main",
    cwd,
  });
  assert.equal(ask.json?.permission, "ask");
  const deny = hook("pretool.ts", ["--host", "cursor", "--policy", POLICY], { command: "rm -rf /", cwd });
  assert.equal(deny.json?.permission, "deny");
  const allow = hook("pretool.ts", ["--host", "cursor", "--policy", POLICY], { command: "git status", cwd });
  assert.equal(allow.json?.permission, "allow");
  const claude = hook("pretool.ts", ["--host", "claude", "--policy", POLICY], {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "gh pr merge 3" },
  });
  assert.deepEqual(claude.json, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: '"gh pr merge" needs a person\'s OK (harness.toml ask)',
    },
  });
  for (const [args, payload] of [
    [["--host", "cursor", "--policy", join(cwd, "nope.toml")], { command: "ls" }],
    [["--host", "cursor"], { command: "ls" }],
    [["--host", "cursor", "--policy", POLICY], "garbage"],
    [["--host", "cursor", "--policy", POLICY], {}],
  ] as const) {
    const r = hook("pretool.ts", [...args], payload);
    assert.equal(r.code, 0);
    assert.equal(r.json?.permission, "deny", JSON.stringify(args));
  }
});

test("logic units", () => {
  assert.deepEqual(segments("FOO=1 git push; ls | wc"), ["git push", "ls", "wc"]);
  assert.equal(decide("git pushx", { ask: ["git push"] }).decision, "allow");
  assert.equal(decide("git push", { ask: ["Bash(git push:*)"] }).decision, "ask");
  assert.deepEqual(findingsFrom('{"ok":false,"code":1,"error":{"rule":"unknown-verb","message":"x"}}'), []);
  assert.deepEqual(findingsFrom('{"findings":[{"level":"error","message":"m"}]}'), [{ level: "error", message: "m" }]);
  assert.equal(isForeign("cursor", { hook_event_name: "PostToolUse" }), true);
  assert.equal(isForeign("claude", { hook_event_name: "PostToolUse" }), false);
});
