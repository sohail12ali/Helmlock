// Live sessions (Claude Code --input-format stream-json --replay-user-messages) against the fake CLI: a message sent
// mid-turn joins the turn; a message the CLI takes in only after the result gets a turn of its own before the run
// ends; a CLI that never acknowledges ends at the first result; after the end, steer() refuses.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunEvent, RunHandle } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { CLAUDE_LIVE, createClaudeNormalizer } from "../runtime-claude/parse.ts";
import { startProcessRun } from "./process-run.ts";
import { cleanEnv } from "./spawn.ts";

const FAKE = join(FIXTURES, "s5-fake", process.platform === "win32" ? "fake-agent.cmd" : "fake-agent");
const LIVE_ARGS = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--replay-user-messages"];

function start(env: Record<string, string>, args = LIVE_ARGS): Promise<RunHandle> {
  return startProcessRun({
    steerable: true,
    attempt: (n) =>
      n > 0
        ? undefined
        : {
            command: FAKE,
            args,
            cwd: tmpdir(),
            env: cleanEnv(process.env, { FAKE_MODE: "echo", ...env }),
            prompt: "first",
            timeoutSec: 60,
            lingerMs: 3000,
            normalizer: createClaudeNormalizer(),
            live: CLAUDE_LIVE,
          },
  });
}

async function drive(h: RunHandle, onEvent: (e: RunEvent) => void | Promise<void>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of h.events) {
    out.push(e);
    await onEvent(e);
  }
  return out;
}

const texts = (evs: RunEvent[]) => evs.filter((e): e is Extract<RunEvent, { type: "text" }> => e.type === "text").map((e) => e.text);

test("a message sent mid-turn joins the turn; one result; the process ends; steer refuses afterwards", async () => {
  const h = await start({ FAKE_TURN_MS: "800" });
  assert.equal(typeof h.steer, "function");
  let sent = false;
  const evs = await drive(h, async (e) => {
    if (e.type === "init" && !sent) {
      sent = true;
      await h.steer?.("more");
    }
  });
  const done = await h.done;
  assert.equal(done.ok, true);
  assert.deepEqual(texts(evs), ["TURN<<first + more>>"]);
  const results = evs.filter((e) => e.type === "result");
  assert.equal(results.length, 1);
  assert.equal((results[0] as { text: string }).text, "first + more");
  await assert.rejects(h.steer?.("too late") as Promise<void>, /not taking messages/);
});

test("a message taken in after the result gets its own turn before the run ends", async () => {
  const h = await start({ FAKE_TURN_MS: "500", FAKE_LATE: "1" });
  let sent = false;
  const evs = await drive(h, async (e) => {
    if (e.type === "init" && !sent) {
      sent = true;
      await h.steer?.("late one");
    }
  });
  assert.equal((await h.done).ok, true);
  assert.deepEqual(texts(evs), ["TURN<<first>>", "TURN<<late one>>"]);
  assert.equal((evs.at(-1) as { text: string }).text, "late one");
});

test("a CLI that never acknowledges ends at the first result", async () => {
  const h = await start({ FAKE_TURN_MS: "200" }, ["-p", "--output-format", "stream-json", "--input-format", "stream-json"]);
  const evs = await drive(h, () => {});
  assert.equal((await h.done).ok, true);
  assert.deepEqual(texts(evs), ["TURN<<first>>"]);
});
