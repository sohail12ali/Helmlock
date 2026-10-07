import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunEvent } from "@helmlock/core";
import { FIXTURES } from "@helmlock/core/testing";
import { createClaudeNormalizer } from "../runtime-claude/parse.ts";
import { type Attempt, startProcessRun } from "./process-run.ts";
import { cleanEnv, isAlive, quoteForCmd, resolveCommand, spawnTarget, startProcess } from "./spawn.ts";

const FAKE = join(FIXTURES, "s5-fake", process.platform === "win32" ? "fake-agent.cmd" : "fake-agent");

function attempt(mode: string, prompt: string, extra: Partial<Attempt> = {}, env: Record<string, string> = {}): Attempt {
  return {
    command: FAKE,
    args: ["-p", "--output-format", "stream-json", "--workspace", "C:\\a dir\\with (parens) & amp"],
    cwd: tmpdir(),
    env: cleanEnv(process.env, { FAKE_MODE: mode, ...env }),
    prompt,
    normalizer: createClaudeNormalizer(),
    ...extra,
  };
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

test("quoteForCmd quotes only when needed and doubles inner quotes", () => {
  assert.equal(quoteForCmd("plain"), "plain");
  assert.equal(quoteForCmd(""), '""');
  assert.equal(quoteForCmd("a b"), '"a b"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
  assert.equal(quoteForCmd("a&b"), '"a&b"');
});

test("a .cmd shim is wrapped in cmd.exe /d /s /c with one outer-quoted line", { skip: process.platform !== "win32" }, () => {
  const t = spawnTarget("C:\\x y\\agent.cmd", ["-p", "--workspace", "C:\\w s"]);
  assert.match(t.command, /cmd\.exe$/i);
  assert.deepEqual(t.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(t.args[3], '""C:\\x y\\agent.cmd" -p --workspace "C:\\w s""');
  assert.equal(t.verbatim, true);
  assert.equal(spawnTarget("C:\\bin\\claude.exe", ["-p"]).verbatim, false);
});

test("resolveCommand finds node through PATH and PATHEXT", async () => {
  assert.ok(await resolveCommand("node"));
  assert.equal(await resolveCommand("definitely-not-a-binary-hl"), null);
});

test("cleanEnv strips Claude nesting variables but keeps auth", () => {
  const env = cleanEnv({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", ANTHROPIC_API_KEY: "k", PATH: "p" });
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "PATH"]);
});

test("a multi-line prompt arrives whole on stdin, args with spaces and & survive the .cmd shim", async () => {
  const prompt = 'Line one: say ALPHA.\nLine two: "quoted" & <angles> %PATH%\n\nLine four.';
  const h = await startProcessRun({ attempt: (n) => (n === 0 ? attempt("echo", prompt) : undefined) });
  const events = await collect(h.events);
  const done = await h.done;
  assert.equal(done.ok, true);
  const texts = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
  assert.equal(texts[0], `PROMPT<<${prompt}>>`);
  assert.equal(texts[1], `ARGS<<${JSON.stringify(["-p", "--output-format", "stream-json", "--workspace", "C:\\a dir\\with (parens) & amp"])}>>`);
  const res = events.at(-1);
  assert.equal(res?.type, "result");
  assert.equal((res as { sessionId?: string }).sessionId, "11111111-2222-3333-4444-555555555555");
});

function pidsOf(pid: number): boolean {
  if (process.platform !== "win32") return isAlive(pid);
  const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
  return out.includes(`"${pid}"`);
}

test("cancel() kills the whole tree and leaves no orphan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-kill-"));
  const pidfile = join(dir, "pid");
  const childfile = join(dir, "child");
  try {
    const h = await startProcessRun({
      attempt: (n) => (n === 0 ? attempt("child", "x", {}, { FAKE_PIDFILE: pidfile, FAKE_CHILDFILE: childfile }) : undefined),
    });
    const events = collect(h.events);
    for (let i = 0; i < 100 && !existsSync(childfile); i++) await new Promise((r) => setTimeout(r, 100));
    const agentPid = Number(readFileSync(pidfile, "utf8"));
    const childPid = Number(readFileSync(childfile, "utf8"));
    assert.ok(pidsOf(childPid), "grandchild runs before cancel");
    await h.cancel();
    const done = await h.done;
    const evs = await events;
    assert.equal(done.ok, false);
    assert.equal((evs.at(-1) as { failureClass?: string }).failureClass, "cancelled");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(pidsOf(agentPid), false, "agent process gone");
    assert.equal(pidsOf(childPid), false, "grandchild gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("silence watchdog kills a run that prints nothing", async () => {
  const h = await startProcessRun({ attempt: (n) => (n === 0 ? attempt("silent", "x", { silenceSec: 1 }) : undefined) });
  const evs = await collect(h.events);
  assert.equal((await h.done).ok, false);
  assert.equal((evs.at(-1) as { failureClass?: string }).failureClass, "stalled");
});

test("timeout kills a chatty run", async () => {
  const h = await startProcessRun({ attempt: (n) => (n === 0 ? attempt("hang", "x", { timeoutSec: 1 }) : undefined) });
  const evs = await collect(h.events);
  const done = await h.done;
  assert.equal(done.timedOut, true);
  assert.equal((evs.at(-1) as { failureClass?: string }).failureClass, "timeout");
});

test("a process that lingers after its result line is killed and the run still counts as ok", async () => {
  const h = await startProcessRun({ attempt: (n) => (n === 0 ? attempt("linger", "x", { lingerMs: 300 }) : undefined) });
  const evs = await collect(h.events);
  const done = await h.done;
  assert.equal(done.ok, true);
  assert.equal((evs.at(-1) as { text?: string }).text, "done but lingering");
});

test("unknown session on --resume retries once with a fresh session", async () => {
  const h = await startProcessRun({
    retryOn: ["unknown_session"],
    attempt: (n) => (n === 0 ? attempt("fail", "x", { args: ["--resume", "abc"] }) : n === 1 ? attempt("fail", "x", { args: [] }) : undefined),
  });
  const evs = await collect(h.events);
  assert.equal((await h.done).ok, true);
  assert.ok(evs.some((e) => e.type === "stderr" && /fresh session/.test(e.text)));
  assert.equal((evs.at(-1) as { text?: string }).text, "fresh");
});

test("startProcess caps an over-long line", async () => {
  const lines: string[] = [];
  const p = startProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(2*1024*1024)+'\\nnext\\n')"],
    cwd: tmpdir(),
    env: cleanEnv(process.env),
    stdin: "",
    onLine: (_s, l) => lines.push(l),
  });
  await p.done;
  assert.equal(lines.length, 2);
  assert.match(lines[0] as string, /\[line truncated\]$/);
  assert.equal(lines[1], "next");
});
