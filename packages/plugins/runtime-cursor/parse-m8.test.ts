// Milestone 8 event vocabulary from a recorded-shape Cursor CLI stream: todo, diff from the edit result, error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { RunEvent } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { CURSOR_CAPABILITIES, createCursorAdapter, cursorArgs } from "./adapter.ts";
import { parseCursorStream } from "./parse.ts";

const of = <T extends RunEvent["type"]>(evs: RunEvent[], t: T) => evs.filter((e): e is Extract<RunEvent, { type: T }> => e.type === t);

test("todo from updateTodos, a diff from a successful edit only, error from the error line", () => {
  const evs = parseCursorStream(readFileSync(join(FIXTURES, "s5-streams", "cursor-m8.jsonl"), "utf8"));
  assert.deepEqual(of(evs, "todo")[0]?.items, [
    { text: "Create notes.txt", status: "in_progress" },
    { text: "List skills", status: "pending" },
    { text: "Read the task", status: "done" },
  ]);
  const diffs = of(evs, "diff");
  assert.equal(diffs.length, 1, "the rejected edit gives no diff");
  assert.equal(diffs[0]?.file, "C:\\work\\demo\\notes.txt");
  assert.equal(diffs[0]?.added, 1);
  assert.equal(diffs[0]?.removed, 0);
  assert.match(diffs[0]?.patch ?? "", /\+hi$/);
  assert.deepEqual(of(evs, "error"), [{ type: "error", message: "Connection lost while streaming" }]);
  assert.equal(of(evs, "stderr").length, 0);
  assert.equal((evs.at(-1) as { ok: boolean }).ok, false);
});

test("an error result with no error line still says why", () => {
  const evs = parseCursorStream(JSON.stringify({ type: "result", subtype: "error", is_error: true, error: "quota" }));
  assert.deepEqual(of(evs, "error"), [{ type: "error", message: "quota" }]);
});

test("adapter: label and capabilities (no steering), --resume only when asked; test() on a missing binary", async () => {
  const a = createCursorAdapter({ command: "no-such-cursor-binary-xyz", env: { PATH: "" } });
  assert.equal(a.label, "Cursor CLI");
  assert.deepEqual(a.capabilities, CURSOR_CAPABILITIES);
  assert.equal(a.capabilities?.steer, false);
  assert.ok(cursorArgs({ prompt: "x", cwd: ".", mode: "plan", resumeSessionId: "s-1" }).includes("--resume"));
  const t = await a.test?.();
  assert.equal(t?.ok, false);
  assert.equal(t?.checks[0]?.level, "error");
});
