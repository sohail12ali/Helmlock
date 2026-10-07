import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RunOptions } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { classify } from "../runtimes/failures.ts";
import { CURSOR_MODE_FLAGS, cursorArgs } from "./adapter.ts";
import { createCursorNormalizer, normalizeCursorStreamLine, parseCursorStream } from "./parse.ts";

const read = (n: string) => readFileSync(join(FIXTURES, "s5-streams", n), "utf8");

test("recorded short run: init, text, camelCase usage, ok result", () => {
  const evs = parseCursorStream(read("cursor-ok.jsonl"));
  assert.deepEqual(
    evs.map((e) => e.type),
    ["init", "text", "usage", "result"],
  );
  const usage = evs[2] as { inputTokens: number; outputTokens: number; costUsd?: number };
  assert.ok(usage.inputTokens > 1000);
  assert.equal(usage.outputTokens, 1);
  assert.equal(usage.costUsd, undefined, "Cursor reports tokens, never dollars");
  assert.equal((evs[3] as { text: string; ok: boolean }).text, "OK");
});

test("recorded tool run: thinking delta, <name>ToolCall start and end paired by call id", () => {
  const evs = parseCursorStream(read("cursor-tool.jsonl"));
  assert.ok(evs.some((e) => e.type === "thinking"));
  const tools = evs.filter((e) => e.type === "tool") as { phase: string; name: string; id: string; isError?: boolean }[];
  assert.deepEqual(
    tools.map((t) => `${t.phase}:${t.name}`),
    ["start:read", "start:glob", "end:read", "end:glob"],
  );
  assert.equal(tools[0]?.id, tools[2]?.id);
  assert.equal(tools[2]?.isError, false);
  assert.equal((evs.at(-1) as { text: string }).text, "banana");
});

test("recorded edit run: edit tool calls are visible", () => {
  const evs = parseCursorStream(read("cursor-edit.jsonl"));
  const starts = evs.filter((e) => e.type === "tool" && e.phase === "start") as { name: string; input: { path: string } }[];
  assert.deepEqual(
    starts.map((s) => s.name),
    ["edit", "edit"],
  );
  assert.match(starts[0]?.input.path ?? "", /a\.toml$/);
});

test("error shapes: error event and is_error result classify", () => {
  const n = createCursorNormalizer();
  n.line(JSON.stringify({ type: "error", message: "Unknown chat abc" }));
  n.line(JSON.stringify({ type: "result", subtype: "error", is_error: true, session_id: "s" }));
  assert.equal(n.turnEnd()?.is_error, true);
  assert.equal(classify(n.turnEnd(), 1).class, "unknown_session");
  assert.equal(normalizeCursorStreamLine('stdout: {"type":"x"}'), '{"type":"x"}');
});

test("args: trust, workspace, mode ladder flags (never --mode default), add-dir, no prompt on the command line", () => {
  const o: RunOptions = { prompt: "secret prompt", cwd: "C:/w", mode: "plan", addDirs: ["C:/a"], model: "gpt-5", resumeSessionId: "chat-1" };
  assert.deepEqual(cursorArgs(o, "win32"), [
    "-p",
    "--output-format",
    "stream-json",
    "--trust",
    "--sandbox",
    "disabled",
    "--workspace",
    "C:/w",
    "--mode",
    "plan",
    "--model",
    "gpt-5",
    "--resume",
    "chat-1",
    "--add-dir",
    "C:/a",
  ]);
  assert.ok(!cursorArgs(o, "linux").includes("--sandbox"));
  assert.deepEqual(CURSOR_MODE_FLAGS["auto-review"], ["--auto-review"]);
  assert.deepEqual(CURSOR_MODE_FLAGS.force, ["--force"]);
  for (const f of Object.values(CURSOR_MODE_FLAGS)) assert.ok(!f.includes("default"));
  assert.ok(!cursorArgs(o).includes("secret prompt"));
});
