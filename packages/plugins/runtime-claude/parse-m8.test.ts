// Milestone 8 event vocabulary from a recorded-shape Claude Code stream: todo, diff (only for edits that succeeded),
// plan, error; the live-session acknowledgement; the adapter's capabilities and arguments.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RunEvent } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { lineChange } from "../runtimes/event-vocab.ts";
import { CLAUDE_CAPABILITIES, claudeArgs, createClaudeAdapter } from "./adapter.ts";
import { CLAUDE_LIVE, parseClaudeStream } from "./parse.ts";

const read = (n: string) => readFileSync(join(FIXTURES, "s5-streams", n), "utf8");
const of = <T extends RunEvent["type"]>(evs: RunEvent[], t: T) => evs.filter((e): e is Extract<RunEvent, { type: T }> => e.type === t);

test("todo from TodoWrite, diffs from successful Edit and MultiEdit only, plan from ExitPlanMode, error on an error result", () => {
  const evs = parseClaudeStream(read("claude-m8.jsonl"));
  assert.deepEqual(of(evs, "todo")[0]?.items, [
    { text: "Read hello.ts", status: "done" },
    { text: "Fix the greeting", status: "in_progress" },
    { text: "Run the tests", status: "pending" },
  ]);
  const diffs = of(evs, "diff");
  assert.equal(diffs.length, 2, "the denied Write gives no diff");
  assert.deepEqual({ file: diffs[0]?.file, added: diffs[0]?.added, removed: diffs[0]?.removed }, { file: "C:\\work\\demo\\hello.ts", added: 2, removed: 1 });
  assert.equal(diffs[0]?.patch, '-  return "helo";\n+  return "hello";\n+  // fixed');
  assert.deepEqual({ added: diffs[1]?.added, removed: diffs[1]?.removed }, { added: 2, removed: 3 });
  // The diff follows the tool end, so the timeline shows it after the edit was accepted.
  const editEnd = evs.findIndex((e) => e.type === "tool" && e.phase === "end" && e.name === "Edit");
  assert.equal(evs[editEnd + 1]?.type, "diff");
  assert.deepEqual(of(evs, "plan"), [{ type: "plan", text: "1. Fix the greeting\n2. Add a test" }]);
  const err = of(evs, "error");
  assert.equal(err.length, 1);
  assert.match(err[0]?.message ?? "", /maximum number of turns/);
  assert.equal(evs.at(-1)?.type, "result");
  assert.equal((evs.at(-1) as { ok: boolean }).ok, false);
  assert.equal(of(evs, "text").length, 0, "the replayed prompt is not shown as text");
});

test("live protocol: one stream-json user line per message; replayed user lines are acknowledgements", () => {
  const line = CLAUDE_LIVE.encode('say "hi"\nplease');
  assert.ok(line.endsWith("\n"));
  assert.deepEqual(JSON.parse(line), { type: "user", message: { role: "user", content: [{ type: "text", text: 'say "hi"\nplease' }] } });
  const replay = read("claude-m8.jsonl").split("\n")[1] as string;
  assert.equal(CLAUDE_LIVE.isAck(replay), true);
  const toolResult = read("claude-m8.jsonl").split("\n")[3] as string;
  assert.equal(CLAUDE_LIVE.isAck(toolResult), false);
});

test("lineChange counts only the changed middle", () => {
  assert.deepEqual(lineChange("a\nb\nc", "a\nB\nc"), { added: 1, removed: 1, patch: "-b\n+B" });
  assert.deepEqual(lineChange("", "x\ny\n"), { added: 2, removed: 0, patch: "+x\n+y" });
  assert.deepEqual(lineChange("same", "same"), { added: 0, removed: 0, patch: "" });
});

test("adapter: label, capabilities, live arguments; test() reports a missing binary as an error", async () => {
  const a = createClaudeAdapter({ command: "no-such-claude-binary-xyz" });
  assert.equal(a.label, "Claude Code");
  assert.deepEqual(a.capabilities, CLAUDE_CAPABILITIES);
  assert.equal(a.capabilities?.steer, true);
  const live = claudeArgs({ prompt: "x", cwd: ".", mode: "plan", live: true } as Parameters<typeof claudeArgs>[0], undefined);
  assert.ok(live.includes("--input-format") && live.includes("--replay-user-messages"));
  assert.ok(!claudeArgs({ prompt: "x", cwd: ".", mode: "plan" }, undefined).includes("--input-format"));
  const t = await a.test?.();
  assert.equal(t?.ok, false);
  assert.equal(t?.checks[0]?.level, "error");
});
