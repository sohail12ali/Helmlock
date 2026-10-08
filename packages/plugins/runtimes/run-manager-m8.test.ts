// Milestone 8 run manager (Blueprint 33, F152-F157) with fake adapters: the concurrency cap and its queue, sessions per
// (role, ticket), say (steer or queue + follow-up run), outcomes from `hl run report`, approval events, worktrees
// with diff and merge on temp git repos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { Context, EngineCapabilities, RunEvent, RunHandle, RunOptions, RuntimeAdapter, RuntimesService } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { ManagedRunOptions } from "./process-run.ts";
import { createRunManager, type RunEventLine, type RunManager } from "./run-manager.ts";
import type { RunRecord } from "./run-record.ts";
import { SESSIONS_FILE } from "./sessions.ts";
import { EventQueue } from "./spawn.ts";

interface FakeRun {
  opts: ManagedRunOptions;
  q: EventQueue<RunEvent>;
  steered: string[];
  finish(ok?: boolean): void;
}
const STEER: EngineCapabilities = { resume: true, steer: true, approve: true, models: true };
const NO_STEER: EngineCapabilities = { resume: true, steer: false, approve: false, models: true };

function fakeAdapter(id: string, caps: EngineCapabilities, runs: FakeRun[]): RuntimeAdapter {
  return {
    id,
    capabilities: caps,
    detect: async () => ({ command: "fake" }),
    async start(opts: RunOptions): Promise<RunHandle> {
      const o = opts as ManagedRunOptions;
      const q = new EventQueue<RunEvent>();
      let resolveDone!: (v: { ok: boolean; exitCode: number | null; timedOut: boolean }) => void;
      const done = new Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }>((r) => {
        resolveDone = r;
      });
      let ended = false;
      const run: FakeRun = {
        opts: o,
        q,
        steered: [],
        finish(ok = true) {
          ended = true;
          q.push({ type: "result", ok, text: ok ? "finished" : "broke" });
          q.end();
          resolveDone({ ok, exitCode: ok ? 0 : 1, timedOut: false });
        },
      };
      runs.push(run);
      return {
        id: o.runId ?? "fake",
        events: q,
        async cancel() {
          ended = true;
          q.end();
          resolveDone({ ok: false, exitCode: null, timedOut: false });
        },
        ...(caps.steer
          ? {
              async steer(text: string) {
                if (ended) throw new Error("ended");
                run.steered.push(text);
              },
            }
          : {}),
        done,
      };
    },
  };
}

let ws: TestWorkspace;
let runs: FakeRun[];
const managers: RunManager[] = [];
const actor = { kind: "person" as const, id: "sam", onBehalfOf: "sam" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withRuntimes(ctx: Context, svc: RuntimesService): Context {
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "get") return (key: string) => (key === "runtimes" ? svc : t.get(key as never));
      const v = Reflect.get(t, k) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}
function makeManager(extra: Partial<Parameters<typeof createRunManager>[0]> = {}): RunManager {
  const adapters = [fakeAdapter("claude-code", STEER, runs), fakeAdapter("cursor", NO_STEER, runs)];
  const svc: RuntimesService = { register: () => () => {}, get: (id) => adapters.find((a) => a.id === id), list: () => adapters };
  const m = createRunManager({ ctx: withRuntimes(ws.runtime.ctx, svc), node: "node", hookScript: "/x/pretool.ts", coalesceMs: 0, ...extra });
  managers.push(m);
  return m;
}
async function until<T>(fn: () => T | undefined | Promise<T | undefined>, ms = 10000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await wait(10);
  }
}
const settled = (m: RunManager) => until(() => (m.active().length === 0 ? true : undefined));
async function collect(it: AsyncIterable<RunEventLine>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const l of it) out.push(l.event);
  return out;
}
const comments = (ticket: string) => {
  const f = join(ws.root, "artifacts", ticket, "comments.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};
const record = (id: string) => JSON.parse(readFileSync(join(ws.root, "runs", `${id}.json`), "utf8")) as RunRecord;

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  await ws.runtime.mountAll();
});
after(async () => {
  for (const m of managers) m.dispose();
  await ws.cleanup();
});

test("concurrency cap: the third run waits as queued, starts FIFO when a slot frees; a queued run can be cancelled", async () => {
  runs = [];
  const m = makeManager({ maxLive: 1 });
  const a = await m.start({ prompt: "one", actor });
  const b = await m.start({ prompt: "two", actor });
  const c = await m.start({ prompt: "three", actor });
  assert.equal(a.status, "running");
  assert.equal(b.status, "queued");
  assert.equal(c.status, "queued");
  assert.equal(runs.length, 1, "queued runs are not started");
  assert.ok((await collect((async function* () {})())).length === 0);
  await m.cancel(c.id, "sam");
  assert.equal(m.get(c.id)?.status, "cancelled");
  runs[0]?.finish();
  await until(() => (runs.length === 2 ? true : undefined));
  assert.equal(m.get(b.id)?.status, "running");
  assert.equal(runs[1]?.opts.prompt, "two");
  runs[1]?.finish();
  await settled(m);
  assert.equal(runs.length, 2, "the cancelled run never started");
  const bEvents = await collect(m.events(b.id));
  assert.match((bEvents[0] as { text: string }).text, /queued/);
  assert.deepEqual(m.get(a.id)?.capabilities, STEER);
});

test("sessions per (role, ticket): kept from init, resumed on the same engine, cwd and instructions; fresh, reset and another engine start fresh", async () => {
  runs = [];
  const m = makeManager();
  const first = await m.start({ prompt: "build slice 1", role: "builder", ticket: "T-001-sa", actor });
  const r0 = runs[0] as FakeRun;
  assert.equal(r0.opts.resumeSessionId, undefined);
  assert.equal(r0.opts.agent, "builder", "the role's agent file runs the run");
  assert.equal(r0.opts.env?.HL_ROLE, "builder");
  assert.equal(r0.opts.live, true, "a steerable engine runs live");
  assert.equal(first.role, "builder");
  r0.q.push({ type: "init", sessionId: "sess-a", model: "m-1" });
  r0.finish();
  await settled(m);
  const store = JSON.parse(readFileSync(join(ws.root, SESSIONS_FILE), "utf8")) as Record<string, { session_id: string; engine: string }>;
  assert.equal(store["builder:T-001-sa"]?.session_id, "sess-a");
  assert.equal(store["builder:T-001-sa"]?.engine, "claude-code");

  await m.start({ prompt: "build slice 2", role: "builder", ticket: "T-001-sa", actor });
  assert.equal(runs[1]?.opts.resumeSessionId, "sess-a");
  runs[1]?.q.push({ type: "init", sessionId: "sess-a" });
  runs[1]?.finish();
  await settled(m);

  await m.start({ prompt: "start over", role: "builder", ticket: "T-001-sa", fresh: true, actor });
  assert.equal(runs[2]?.opts.resumeSessionId, undefined);
  runs[2]?.finish(); // no session id seen: the entry stays
  await settled(m);

  await m.start({ prompt: "other folder", role: "builder", ticket: "T-001-sa", cwd: tmpdir(), actor });
  assert.equal(runs[3]?.opts.resumeSessionId, undefined, "cwd changed");
  runs[3]?.finish();
  await settled(m);

  await m.start({ prompt: "on cursor", role: "builder", ticket: "T-001-sa", runtime: "cursor", actor });
  assert.equal(runs[4]?.opts.resumeSessionId, undefined, "another engine");
  assert.equal(runs[4]?.opts.live, undefined, "cursor cannot steer");
  runs[4]?.finish();
  await settled(m);

  await m.resetSession("builder", "T-001-sa");
  await m.start({ prompt: "after reset", role: "builder", ticket: "T-001-sa", actor });
  assert.equal(runs[5]?.opts.resumeSessionId, undefined);
  runs[5]?.q.push({ type: "init", sessionId: "sess-b" });
  runs[5]?.finish();
  await settled(m);

  // The engine no longer knows the session and the fresh retry gives none either: the entry goes.
  await m.start({ prompt: "resume fails", role: "builder", ticket: "T-001-sa", actor });
  assert.equal(runs[6]?.opts.resumeSessionId, "sess-b");
  runs[6]?.q.push({ type: "stderr", text: "[hl] unknown_session: retrying with a fresh session" });
  runs[6]?.finish(false);
  await settled(m);
  const after = JSON.parse(readFileSync(join(ws.root, SESSIONS_FILE), "utf8")) as Record<string, unknown>;
  assert.equal(after["builder:T-001-sa"], undefined);
});

test("say: a steerable live run takes the message live; otherwise it is queued and a follow-up run resumes the session", async () => {
  runs = [];
  const m = makeManager();
  const live = await m.start({ prompt: "work", role: "builder", ticket: "T-002-sa", actor });
  assert.equal(await m.say(live.id, "also add a test", "sam"), "live");
  assert.deepEqual(runs[0]?.steered, ["also add a test"]);
  runs[0]?.finish();
  await settled(m);
  const evs = await collect(m.events(live.id));
  assert.ok(evs.some((e) => e.type === "message" && e.delivered === "live" && e.by === "sam"));

  const cur = await m.start({ prompt: "verify", role: "verifier", ticket: "T-003-sa", runtime: "cursor", actor });
  runs[1]?.q.push({ type: "init", sessionId: "cur-1" });
  assert.equal(await m.say(cur.id, "check the edge case", "sam"), "queued");
  assert.equal(await m.say(cur.id, "and the docs", "sam"), "queued");
  assert.equal(m.get(cur.id)?.queued_messages, 2);
  runs[1]?.finish();
  const follow = await until(() => runs[2]);
  assert.match(follow.opts.prompt, /check the edge case/);
  assert.match(follow.opts.prompt, /and the docs/);
  assert.equal(follow.opts.resumeSessionId, "cur-1", "the follow-up resumes the (role, ticket) session");
  assert.equal(follow.opts.ticket, "T-003-sa");
  assert.equal(follow.opts.agent, "verifier");
  const curEvents = await collect(m.events(cur.id));
  assert.ok(curEvents.some((e) => e.type === "stderr" && /went to run/.test(e.text)));
  assert.equal(m.get(cur.id)?.queued_messages, 0);
  follow.finish();
  await settled(m);
  await assert.rejects(m.say("run-nope", "x", "sam"), { rule: "unknown-run" } as object);
});

test("report: outcome event, state and record, a ticket comment by the role; no report = none; a filed report is picked up at the end", async () => {
  runs = [];
  const m = makeManager();
  const s = await m.start({ prompt: "build", role: "builder", ticket: "T-004-sa", actor });
  const st = await m.report(s.id, { outcome: "done", summary: "Slice 1 built", next: "verify slice 1", next_role: "verifier" }, "builder");
  assert.deepEqual(st.outcome, { outcome: "done", summary: "Slice 1 built", next: "verify slice 1", next_role: "verifier" });
  assert.match(comments("T-004-sa"), /Builder: \[done\] Slice 1 built\. Next: verify slice 1 \(verifier\)/);
  runs[0]?.finish();
  await settled(m);
  assert.equal((record(s.id).outcome as { outcome: string }).outcome, "done");
  assert.equal(record(s.id).role, "builder");
  const evs = await collect(m.events(s.id));
  assert.ok(evs.some((e) => e.type === "outcome" && e.outcome.outcome === "done"));

  const quiet = await m.start({ prompt: "silent", ticket: "T-005-sa", actor });
  runs[1]?.finish();
  await settled(m);
  assert.equal(m.get(quiet.id)?.outcome, "none");
  assert.equal(record(quiet.id).outcome, "none");

  // A Cursor run has no server channel: `hl run report --run <id>` files it; the run manager takes it at the end.
  const filed = await m.start({ prompt: "review", role: "verifier", ticket: "T-005-sa", runtime: "cursor", actor });
  const res = await ws.run("run report", { outcome: "needs-input", summary: "Which currency?", run: filed.id });
  assert.equal(res.ok, true, JSON.stringify(res));
  runs[2]?.finish();
  await settled(m);
  assert.equal((m.get(filed.id)?.outcome as { outcome?: string } | undefined)?.outcome, "needs-input");
  assert.match(comments("T-005-sa"), /Verifier: \[needs-input\] Which currency\?/);
  assert.equal(existsSync(join(ws.root, "runs", "reports", `${filed.id}.json`)), false, "the report file is consumed");

  // After the run: straight into the record.
  const late = await ws.run("run report", { outcome: "review", summary: "Late note", run: quiet.id });
  assert.equal(late.ok, true);
  assert.equal((record(quiet.id).outcome as { outcome: string }).outcome, "review");
  // From the list too.
  const listed = await m.list({ ticket: "T-005-sa" });
  assert.ok(listed.some((r) => r.id === quiet.id));
  assert.ok(listed.every((r) => r.ticket === "T-005-sa"));
  assert.equal((await m.list({ role: "verifier", limit: 1 })).length, 1);
});

test("approval cards of a run show on its timeline", async () => {
  runs = [];
  const m = makeManager();
  const s = await m.start({ prompt: "needs a card", actor });
  await ws.runtime.ctx.emit("approval.requested", { id: "ap-1", action: "shell", detail: "npm test", runId: s.id, localOnly: false });
  await ws.runtime.ctx.emit("approval.decided", { id: "ap-1", decision: "allow", by: "sam", channel: "console" });
  runs[0]?.finish();
  await settled(m);
  const approvals = (await collect(m.events(s.id))).filter((e) => e.type === "approval");
  assert.deepEqual(
    approvals.map((e) => (e as { status: string }).status),
    ["pending", "allowed"],
  );
  assert.match((approvals[0] as { summary: string }).summary, /shell: npm test/);
});

// ---------- worktrees (F156) ----------
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@x", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true });
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "hl-repo-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "one\ntwo\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

test("worktree: hl/<ticket> outside the repo, diff while live, a wip commit at the end, merge into the current branch", async () => {
  runs = [];
  const repo = makeRepo();
  try {
    const m = makeManager();
    const s = await m.start({ prompt: "build", role: "builder", ticket: "T-001-sa", worktree: true, cwd: repo, actor });
    const wtPath = join(ws.root, ".hl-cache", "worktrees", resolve(repo).split(/[\\/]/).pop() as string, "T-001-sa");
    assert.equal(resolve(runs[0]?.opts.cwd as string), resolve(wtPath));
    assert.deepEqual(m.get(s.id)?.worktree, { path: wtPath, branch: "hl/T-001-sa", repo: realpathSync.native(repo) });
    writeFileSync(join(wtPath, "new.ts"), "a\nb\nc\n");
    writeFileSync(join(wtPath, "README.md"), "one\nTWO\n");
    const liveDiff = await m.diff(s.id);
    assert.deepEqual(
      liveDiff.files.sort((a, b) => (a.file < b.file ? -1 : 1)),
      [
        { file: "README.md", added: 1, removed: 1 },
        { file: "new.ts", added: 3, removed: 0 },
      ],
    );
    assert.match(liveDiff.patch, /\+TWO/);
    assert.deepEqual(await m.merge(s.id, "sam"), { merged: false, message: `run ${s.id} is still running; merge when it has ended` });
    runs[0]?.finish();
    await settled(m);
    assert.match(git(wtPath, "log", "--oneline", "-1"), /wip: T-001-sa/);
    assert.equal(git(wtPath, "status", "--porcelain").trim(), "", "everything committed");
    assert.equal((await m.diff(s.id)).files.length, 2);

    // A dirty main checkout refuses; a clean one merges.
    writeFileSync(join(repo, "README.md"), "dirty\n");
    const dirty = await m.merge(s.id, "sam");
    assert.equal(dirty.merged, false);
    assert.match(dirty.message, /uncommitted changes/);
    git(repo, "checkout", "--", "README.md");
    const ok = await m.merge(s.id, "sam");
    assert.equal(ok.merged, true, ok.message);
    assert.match(ok.message, /fast-forward/);
    assert.equal(readFileSync(join(repo, "new.ts"), "utf8").replaceAll("\r\n", "\n"), "a\nb\nc\n");
    assert.equal(m.get(s.id)?.worktree?.merged, true);
    assert.equal(record(s.id).worktree?.merged, true);
    assert.match(comments("T-001-sa"), /Merged hl\/T-001-sa/);
    assert.equal((await m.merge(s.id, "sam")).merged, false);

    // The next run on the ticket reuses the worktree.
    await m.start({ prompt: "again", role: "builder", ticket: "T-001-sa", worktree: true, cwd: repo, actor });
    assert.equal(resolve(runs[1]?.opts.cwd as string), resolve(wtPath));
    runs[1]?.finish();
    await settled(m);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree merge refuses a conflict and leaves the main checkout untouched; no repo = work in place", async () => {
  runs = [];
  const repo = makeRepo();
  try {
    const m = makeManager();
    const s = await m.start({ prompt: "edit", ticket: "T-002-sa", worktree: true, cwd: repo, actor });
    const wt = m.get(s.id)?.worktree?.path as string;
    writeFileSync(join(wt, "README.md"), "one\nbranch\n");
    runs[0]?.finish();
    await settled(m);
    writeFileSync(join(repo, "README.md"), "one\nmain\n");
    git(repo, "commit", "-q", "-am", "main change");
    const head = git(repo, "rev-parse", "HEAD").trim();
    const res = await m.merge(s.id, "sam");
    assert.equal(res.merged, false);
    assert.match(res.message, /conflicts/);
    assert.equal(git(repo, "rev-parse", "HEAD").trim(), head);
    assert.equal(git(repo, "status", "--porcelain").trim(), "");

    const plain = mkdtempSync(join(tmpdir(), "hl-plain-"));
    const inPlace = await m.start({ prompt: "no git here", ticket: "T-003-sa", worktree: true, cwd: plain, actor });
    assert.equal(resolve(runs[1]?.opts.cwd as string), resolve(plain));
    assert.equal(m.get(inPlace.id)?.worktree, undefined);
    runs[1]?.finish();
    await settled(m);
    await assert.rejects(m.diff(inPlace.id), { rule: "no-worktree" } as object);
    rmSync(plain, { recursive: true, force: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
