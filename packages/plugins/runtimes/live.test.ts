// Live runs against the real CLIs. Skipped unless HL_LIVE=1 (they cost tokens and need a login).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunEvent, RuntimeAdapter } from "@helmlock/core";
import { createClaudeAdapter } from "../runtime-claude/adapter.ts";
import { createCursorAdapter } from "../runtime-cursor/adapter.ts";

const live = process.env.HL_LIVE === "1";
const PROMPT = "Line one: say ALPHA.\nLine two: say OMEGA.\nReply with exactly those two words on two lines and nothing else.";

async function drain(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function liveRun(name: string, adapter: () => RuntimeAdapter, model?: string) {
  test(`live ${name}: a multi-line prompt on stdin, stream parsed, ok result with usage`, { skip: !live && "set HL_LIVE=1", timeout: 240000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), `hl-live-${name}-`));
    try {
      const a = adapter();
      const info = await a.detect();
      assert.ok(info, `${name} CLI not found`);
      const h = await a.start({ prompt: PROMPT, cwd: dir, mode: "plan", timeoutSec: 200, silenceSec: 120, ...(model ? { model } : {}) });
      const evs = await drain(h.events);
      const done = await h.done;
      const result = evs.at(-1) as Extract<RunEvent, { type: "result" }>;
      process.stdout.write(`# ${name} ${info.version ?? ""}: ok=${done.ok} exit=${done.exitCode} result=${JSON.stringify(result.text)} types=${evs.map((e) => e.type).join(",")}\n`);
      assert.equal(done.ok, true, JSON.stringify(result));
      assert.match(result.text, /ALPHA[\s\S]*OMEGA/);
      assert.ok(evs.some((e) => e.type === "init"));
      assert.ok(evs.some((e) => e.type === "usage" && e.outputTokens > 0));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

liveRun("claude", () => createClaudeAdapter(), "haiku");
liveRun("cursor", () => createCursorAdapter({ protect: false }));

test("live cursor: cancel() mid-run leaves no process of the tree behind", { skip: (!live || process.platform !== "win32") && "HL_LIVE=1 on Windows", timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-live-kill-"));
  writeFileSync(join(dir, "notes.md"), "x\n");
  const tag = dir.split(/[\\/]/).at(-1) as string;
  // Every process of this run carries the unique temp folder on its command line (--workspace <dir>).
  const procs = () =>
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`],
      { encoding: "utf8" },
    )
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/powershell/i.test(l));
  try {
    const h = await createCursorAdapter({ protect: false }).start({ prompt: "Count slowly from 1 to 200, one number per line.", cwd: dir, mode: "ask" });
    const evs = drain(h.events);
    await new Promise((r) => setTimeout(r, 4000));
    const during = procs();
    await h.cancel();
    await h.done;
    await evs;
    await new Promise((r) => setTimeout(r, 1500));
    const left = procs();
    process.stdout.write(`# cursor kill: during=${JSON.stringify(during)} left=${JSON.stringify(left)}\n`);
    assert.ok(during.length > 0, "the run had processes to kill");
    assert.deepEqual(left, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
