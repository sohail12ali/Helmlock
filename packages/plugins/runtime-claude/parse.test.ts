import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RunOptions } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { classify } from "../runtimes/failures.ts";
import { CLAUDE_PERMISSION_MODE, claudeArgs } from "./adapter.ts";
import { createClaudeNormalizer, parseClaudeStream } from "./parse.ts";

const read = (n: string) => readFileSync(join(FIXTURES, "s5-streams", n), "utf8");

test("recorded short run: init, text, usage with cost, ok result", () => {
  const evs = parseClaudeStream(read("claude-ok.jsonl"));
  assert.deepEqual(
    evs.map((e) => e.type),
    ["init", "text", "usage", "result"],
  );
  const init = evs[0] as { sessionId: string };
  assert.match(init.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal((evs[1] as { text: string }).text, "OK");
  const usage = evs[2] as { inputTokens: number; outputTokens: number; cacheWriteTokens: number; costUsd: number };
  assert.ok(usage.outputTokens > 0 && usage.cacheWriteTokens > 0 && usage.costUsd > 0);
  assert.deepEqual(evs[3], { type: "result", ok: true, text: "OK", sessionId: init.sessionId });
});

test("recorded tool run: tool start with input, tool end matched by id, final text", () => {
  const n = createClaudeNormalizer();
  const evs = read("claude-tool.jsonl")
    .split("\n")
    .flatMap((l) => n.line(l));
  const tools = evs.filter((e) => e.type === "tool") as { phase: string; name: string; id: string; input?: { file_path?: string }; isError?: boolean }[];
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.phase, "start");
  assert.equal(tools[0]?.name, "Read");
  assert.match(tools[0]?.input?.file_path ?? "", /hello\.txt$/);
  assert.deepEqual({ ...tools[1], id: undefined }, { type: "tool", phase: "end", name: "Read", id: undefined, isError: false });
  assert.equal(tools[1]?.id, tools[0]?.id);
  assert.equal((evs.at(-1) as { text: string }).text, "banana");
  assert.equal(n.turnEnd()?.subtype, "success");
  assert.equal(classify(n.turnEnd(), 0).class, "");
});

test("partial stream_event deltas are emitted and the full assistant text is not repeated", () => {
  const lines = [
    { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello" }] } },
    "not json at all",
  ];
  const evs = parseClaudeStream(lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  assert.deepEqual(evs, [
    { type: "thinking", text: "hmm" },
    { type: "text", text: "Hel" },
    { type: "text", text: "lo" },
    { type: "raw", line: "not json at all" },
  ]);
});

test("an error result is classified from its terminal fields", () => {
  const n = createClaudeNormalizer();
  n.line(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "No conversation found with session id x" }));
  assert.equal(classify(n.turnEnd(), 1).class, "unknown_session");
  const q = createClaudeNormalizer();
  q.line(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Claude usage limit reached. Resets at 4pm" }));
  assert.equal(classify(q.turnEnd(), 1).class, "quota");
  assert.equal(classify(q.turnEnd(), 1).retryable, true);
});

test("args: stream-json, permission mode from the ladder, never default or bypass, --resume only for a UUID", () => {
  const base: RunOptions = { prompt: "p", cwd: "C:/w", mode: "plan", addDirs: ["C:/a", "C:/b"], agent: "builder", model: "haiku" };
  assert.deepEqual(claudeArgs(base, undefined), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "plan",
    "--allowedTools",
    "Bash(hl:*),Bash(hl.cmd:*),Bash(./hl:*)",
    "--model",
    "haiku",
    "--agent",
    "builder",
    "--add-dir",
    "C:/a",
    "--add-dir",
    "C:/b",
  ]);
  assert.ok(!claudeArgs(base, "not-a-uuid").includes("--resume"));
  assert.deepEqual(claudeArgs(base, "11111111-2222-3333-4444-555555555555").slice(-2), ["--resume", "11111111-2222-3333-4444-555555555555"]);
  for (const m of Object.values(CLAUDE_PERMISSION_MODE)) assert.ok(!["default", "bypassPermissions"].includes(m));
  assert.ok(!claudeArgs(base, undefined).includes("p"), "the prompt never goes on the command line");
});
