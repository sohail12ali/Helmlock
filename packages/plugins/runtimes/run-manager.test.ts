import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Context, RunEvent, RunHandle, RunOptions, RuntimeAdapter, RuntimesService } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { ManagedRunOptions } from "./process-run.ts";
import { createRunManager, type RunEventLine, type RunManager } from "./run-manager.ts";
import type { RunRecord } from "./run-record.ts";
import { EventQueue } from "./spawn.ts";

/** A controllable adapter: each start() gives a FakeRun the test drives. */
interface FakeRun {
  opts: ManagedRunOptions;
  q: EventQueue<RunEvent>;
  finish(ok?: boolean): void;
  cancelled: boolean;
  settingsSeen?: string;
}
function fakeAdapter(id: "claude-code" | "cursor", runs: FakeRun[], root: () => string): RuntimeAdapter {
  return {
    id,
    detect: async () => ({ command: "fake" }),
    async start(opts: RunOptions): Promise<RunHandle> {
      const o = opts as ManagedRunOptions;
      const q = new EventQueue<RunEvent>();
      let resolveDone!: (v: { ok: boolean; exitCode: number | null; timedOut: boolean }) => void;
      const done = new Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }>((r) => {
        resolveDone = r;
      });
      const run: FakeRun = {
        opts: o,
        q,
        cancelled: false,
        finish(ok = true) {
          q.push({ type: "result", ok, text: ok ? "all done\nsecond line" : "it broke", ...(ok ? {} : { failureClass: "process_lost" }) });
          q.end();
          resolveDone({ ok, exitCode: ok ? 0 : 1, timedOut: false });
        },
      };
      const settings = o.extraArgs?.[1];
      if (settings && existsSync(settings)) run.settingsSeen = readFileSync(settings, "utf8");
      void root;
      runs.push(run);
      return {
        id: o.runId ?? "fake",
        events: q,
        async cancel() {
          run.cancelled = true;
          q.end();
          resolveDone({ ok: false, exitCode: null, timedOut: false });
        },
        done,
      };
    },
  };
}

let ws: TestWorkspace;
let runs: FakeRun[];
let manager: RunManager;
const actor = { kind: "person" as const, id: "sam", onBehalfOf: "sam" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls until every run of the manager has ended (the record is written and the settings file removed by then). */
async function settled(m: RunManager = manager): Promise<void> {
  const t0 = Date.now();
  while (m.active().length) {
    if (Date.now() - t0 > 10000) throw new Error("runs did not end");
    await wait(10);
  }
}

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
  const adapters = [fakeAdapter("claude-code", runs, () => ws.root), fakeAdapter("cursor", runs, () => ws.root)];
  const svc: RuntimesService = { register: () => () => {}, get: (id) => adapters.find((a) => a.id === id), list: () => adapters };
  return createRunManager({ ctx: withRuntimes(ws.runtime.ctx, svc), node: "node", hookScript: "/x/pretool.ts", ...extra });
}

async function collect(it: AsyncIterable<RunEventLine>): Promise<RunEventLine[]> {
  const out: RunEventLine[] = [];
  for await (const l of it) out.push(l);
  return out;
}

before(async () => {
  ws = await createTestWorkspace({ catalog });
  await ws.runtime.mountAll();
});
after(async () => {
  await ws.cleanup();
});

test("start, buffered events with seq numbers, replay from a seq, the record written at the end", async () => {
  runs = [];
  manager = makeManager();
  const s = await manager.start({ prompt: "  summarise  ", ticket: "T-001-sa", agent: "analyst", actor });
  assert.equal(s.status, "running");
  assert.equal(s.mode, "plan");
  assert.equal(s.runtime, "claude-code");
  assert.deepEqual(
    manager.active().map((a) => a.id),
    [s.id],
  );
  const run = runs[0] as FakeRun;
  assert.equal(run.opts.prompt, "summarise");
  assert.equal(run.opts.env?.HL_RUN_ID, s.id);
  assert.equal(run.opts.runId, s.id);
  assert.equal(run.opts.extraArgs, undefined, "no server env: no approval hook");
  run.q.push({ type: "init", sessionId: "sess-1" });
  run.q.push({ type: "text", text: "a" });
  run.q.push({ type: "usage", inputTokens: 5, outputTokens: 2, costUsd: 0.01 });
  const live = collect(manager.events(s.id, 0));
  run.q.push({ type: "text", text: "b" });
  run.finish(true);
  const all = await live;
  assert.deepEqual(
    all.map((l) => l.seq),
    [0, 1, 2, 3, 4],
  );
  assert.equal(all[4]?.event.type, "result");
  const tail = await collect(manager.events(s.id, 3));
  assert.deepEqual(
    tail.map((l) => l.seq),
    [3, 4],
  );
  await settled();
  const st = manager.get(s.id);
  assert.equal(st?.status, "done");
  assert.equal(st?.first_result_line, "all done");
  assert.deepEqual(st?.usage, { input_tokens: 5, output_tokens: 2, cost_usd: 0.01 });
  assert.deepEqual(manager.active(), []);
  const rec = JSON.parse(readFileSync(join(ws.root, "runs", `${s.id}.json`), "utf8")) as RunRecord;
  assert.equal(rec.id, s.id);
  assert.equal(rec.ok, true);
  assert.equal(rec.ticket, "T-001-sa");
  assert.equal(rec.agent, "analyst");
  assert.equal(rec.session_id, "sess-1");
  assert.equal(rec.failure_class, null);
  assert.equal(rec.origin, undefined, "no origin given: none recorded");
});

test("one active run per ticket (F65), identical starts within 10 s coalesce (F134), force is refused", async () => {
  runs = [];
  manager = makeManager();
  const a = await manager.start({ prompt: "plan it", ticket: "T-002-sa", actor });
  const twin = await manager.start({ prompt: "plan it", ticket: "T-002-sa", actor });
  assert.equal(twin.id, a.id);
  assert.equal(runs.length, 1);
  await assert.rejects(manager.start({ prompt: "something else", ticket: "T-002-sa", actor }), { rule: "run-active" } as object);
  const other = await manager.start({ prompt: "something else", ticket: "T-003-sa", actor });
  assert.notEqual(other.id, a.id);
  await assert.rejects(manager.start({ prompt: "x", mode: "force", actor }), { rule: "mode-not-allowed" } as object);
  await assert.rejects(manager.start({ prompt: "   ", actor }), { rule: "bad-request" } as object);
  for (const r of runs) r.finish();
  await settled();
  // Finished, but still inside the coalescing window: the same run comes back.
  assert.equal((await manager.start({ prompt: "plan it", ticket: "T-002-sa", actor })).id, a.id);
  const short = makeManager({ coalesceMs: 0 });
  const fresh = await short.start({ prompt: "plan it", ticket: "T-002-sa", actor });
  assert.notEqual(fresh.id, a.id);
  (runs.at(-1) as FakeRun).finish();
});

test("cancel kills the run; status and record say cancelled; the origin is kept in state and record", async () => {
  runs = [];
  manager = makeManager();
  const s = await manager.start({ prompt: "long job", ticket: "T-004-sa", actor, origin: "telegram:42" });
  assert.equal(s.origin, "telegram:42");
  assert.equal(manager.active()[0]?.origin, "telegram:42");
  const it = collect(manager.events(s.id));
  await manager.cancel(s.id, "sam");
  assert.equal(runs[0]?.cancelled, true);
  const lines = await it;
  assert.ok(lines.some((l) => l.event.type === "stderr" && l.event.text.includes("cancelled by sam")));
  await settled();
  assert.equal(manager.get(s.id)?.status, "cancelled");
  const rec = JSON.parse(readFileSync(join(ws.root, "runs", `${s.id}.json`), "utf8")) as RunRecord;
  assert.equal(rec.ok, false);
  assert.equal(rec.failure_class, "cancelled");
  assert.equal(rec.origin, "telegram:42");
  await assert.rejects(manager.cancel("run-nope", "sam"), { rule: "unknown-run" } as object);
});

test("server-started Claude runs get a per-run settings file with the PreToolUse hook; Cursor runs do not get the token", async () => {
  runs = [];
  manager = makeManager();
  const env = { HL_SERVER_URL: "http://127.0.0.1:1", HL_HOOK_TOKEN: "secret" };
  const s = await manager.start({ prompt: "try git status", mode: "ask", env, actor });
  const run = runs[0] as FakeRun;
  assert.equal(run.opts.approvalHook, true);
  assert.equal(run.opts.extraArgs?.[0], "--settings");
  const file = run.opts.extraArgs?.[1] as string;
  assert.ok(file.endsWith(join("runs", "hooks", `${s.id}.settings.json`)));
  const settings = JSON.parse(run.settingsSeen ?? "{}") as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  const hook = settings.hooks.PreToolUse[0];
  assert.equal(hook?.matcher, "^(Bash|Write|Edit|MultiEdit|WebFetch)$");
  assert.match(hook?.hooks[0]?.command ?? "", /"\/x\/pretool\.ts" --host claude --server --timeout \d+/);
  assert.equal(run.opts.env?.HL_HOOK_TOKEN, "secret");
  run.finish();
  await settled();
  assert.equal(existsSync(file), false, "settings file removed when the run ends");

  await manager.start({ prompt: "auto edit", mode: "auto-review", env, actor });
  const auto = JSON.parse((runs[1] as FakeRun).settingsSeen ?? "{}") as { hooks: { PreToolUse: { matcher: string }[] } };
  assert.equal(auto.hooks.PreToolUse[0]?.matcher, "^(Bash|WebFetch)$", "auto-review accepts edits without a card");
  (runs[1] as FakeRun).finish();

  await manager.start({ prompt: "cursor job", runtime: "cursor", env, actor });
  const cur = runs[2] as FakeRun;
  assert.equal(cur.opts.extraArgs, undefined);
  assert.equal(cur.opts.env?.HL_HOOK_TOKEN, undefined);
  assert.equal(cur.opts.env?.HL_SERVER_URL, undefined);
  cur.finish();
  await settled();
});

test("silence is flagged (not killed) at each threshold; the buffer keeps the newest events and their seq", async () => {
  runs = [];
  manager = makeManager({ silenceFlagsMs: [40, 80], tickMs: 10, bufferCap: 3 });
  const s = await manager.start({ prompt: "quiet", actor });
  const run = runs[0] as FakeRun;
  await wait(150);
  run.q.push({ type: "text", text: "x" });
  run.q.push({ type: "text", text: "y" });
  run.finish();
  await settled();
  const lines = await collect(manager.events(s.id, 0));
  assert.deepEqual(
    lines.map((l) => l.seq),
    [2, 3, 4],
    "oldest trimmed, seq kept",
  );
  const all = makeManager({ silenceFlagsMs: [40, 80], tickMs: 10 });
  const s2 = await all.start({ prompt: "quiet 2", actor });
  await wait(150);
  (runs.at(-1) as FakeRun).finish();
  const l2 = await collect(all.events(s2.id));
  const notes = l2.filter((l) => l.event.type === "stderr").map((l) => (l.event as { text: string }).text);
  assert.equal(notes.length, 2);
  assert.match(notes[0] as string, /no output for/);
  assert.equal(manager.get(s.id)?.status, "done");
});
