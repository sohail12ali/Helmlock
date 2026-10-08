import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ApprovalCardData,
  ApprovalQueueService,
  ChatTurn,
  CompletionDelta,
  ProvidersService,
  RunEvent,
  RunHandle,
  RunMode,
  ToolSpec,
} from "@helmlock/core";
import { ProviderError } from "../providers/wire.ts";
import { DEFAULT_PROTECTED } from "../runtimes/protect.ts";
import { createLoopAdapter } from "./adapter.ts";
import { type LoopDeps, startLoop } from "./loop.ts";
import { runProcess, splitArgs } from "./proc.ts";
import { SUMMARY_PREFIX } from "./session.ts";
import type { CommandRunner, ShellRunner } from "./tools.ts";

type Req = { messages: ChatTurn[]; tools?: ToolSpec[] };
type Step = { text?: string; calls?: { name: string; args: unknown }[]; usage?: [number, number]; throw?: unknown };
type Script = (Step | ((req: Req) => Step | Promise<Step>))[];

function fakeProviders(script: Script, o: { contextWindow?: number; summary?: string } = {}) {
  const requests: Req[] = [];
  let n = 0;
  const svc: ProvidersService = {
    providers: () => [{ id: "fake", label: "Fake", base_url: "http://127.0.0.1:9", compat: {} }],
    models: () => [
      {
        id: "fake/m",
        provider: "fake",
        label: "m",
        ...(o.contextWindow ? { context_window: o.contextWindow } : {}),
        capabilities: { tool_calls: true, vision: false, streaming: true },
      },
    ],
    defaultModel: () => "fake/m",
    async *complete(req): AsyncIterable<CompletionDelta> {
      const r: Req = { messages: JSON.parse(JSON.stringify(req.messages)) as ChatTurn[], ...(req.tools ? { tools: req.tools } : {}) };
      requests.push(r);
      if (!req.tools) {
        yield { type: "text", text: o.summary ?? "SUMMARY of the old work" };
        yield { type: "done", finish_reason: "stop" };
        return;
      }
      const next = script.shift();
      const step: Step = next === undefined ? { text: "all done" } : typeof next === "function" ? await next(r) : next;
      if (step.throw) throw step.throw;
      if (step.text) yield { type: "text", text: step.text };
      for (const c of step.calls ?? []) yield { type: "tool_call", id: `call_${++n}`, name: c.name, arguments: JSON.stringify(c.args) };
      if (step.usage) yield { type: "usage", input_tokens: step.usage[0], output_tokens: step.usage[1] };
      yield { type: "done", finish_reason: step.calls?.length ? "tool_calls" : "stop" };
    },
    probe: async () => ({ provider: "fake", reachable: true, models: ["m"], chat: true, streaming: true, tool_calls: true, model: "m" }),
    probeDraft: async () => ({ provider: "draft", reachable: false, models: [], chat: false, streaming: false, tool_calls: false }),
  };
  return { svc, requests };
}

function fakeQueue(decision: "allow" | "deny") {
  const cards: ApprovalCardData[] = [];
  const q: ApprovalQueueService = {
    request(req) {
      const card: ApprovalCardData = { ...req, id: `ap-${cards.length + 1}`, created: "", expires: "", status: "pending" };
      cards.push(card);
      return new Promise((ok) =>
        setTimeout(() => {
          Object.assign(card, { status: decision === "allow" ? "allowed" : "denied", decided_by: "sam", decided_via: "console" });
          ok({ ...card });
        }, 5),
      );
    },
    pending: () => cards.filter((c) => c.status === "pending").map((c) => ({ ...c })),
    recent: () => [...cards],
    answer: () => {
      throw new Error("not used");
    },
  };
  return { q, cards };
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "hl-loop-"));
  const root = join(base, "knowledge");
  const delivery = join(base, "delivery");
  const project = join(root, "projects", "app");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(delivery, ".claude", "agents"), { recursive: true });
  mkdirSync(join(delivery, ".claude", "skills", "spec"), { recursive: true });
  writeFileSync(
    join(delivery, ".claude", "agents", "builder.md"),
    "---\nname: builder\ndescription: Builds.\n---\n\n# Builder\nYou write code for one slice.\n",
  );
  writeFileSync(join(delivery, ".claude", "skills", "spec", "SKILL.md"), "---\nname: spec\ndescription: Writes specs.\n---\n\n# /spec\nSPEC BODY\n");
  writeFileSync(join(root, "AGENTS.md"), "# Rulebook\nAlways be careful.\n");
  writeFileSync(join(base, "outside.txt"), "secret outside\n");
  return { base, root, delivery, project, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

interface Harness {
  handle: RunHandle;
  events: RunEvent[];
  done: Promise<RunEvent[]>;
}

function run(
  f: ReturnType<typeof fixture>,
  providers: ProvidersService,
  o: { prompt?: string; mode?: RunMode; queue?: ApprovalQueueService; deps?: Partial<LoopDeps>; resume?: string; role?: string } = {},
): Harness {
  const deps: LoopDeps = {
    providers: () => providers,
    queue: () => o.queue,
    root: f.root,
    deliveryRoot: f.delivery,
    author: "sam",
    protectedGlobs: DEFAULT_PROTECTED,
    sleep: async () => {},
    rg: async () => ({ code: null, out: "", timedOut: false, spawnError: "ENOENT" }),
    ...o.deps,
  };
  const handle = startLoop(deps, {
    prompt: o.prompt ?? "do the task",
    cwd: f.project,
    mode: o.mode ?? "auto-review",
    runId: "run-test",
    role: o.role ?? "builder",
    ...(o.resume ? { resumeSessionId: o.resume } : {}),
  });
  const events: RunEvent[] = [];
  const done = (async () => {
    for await (const e of handle.events) events.push(e);
    await handle.done;
    return events;
  })();
  return { handle, events, done };
}

const toolResults = (req: Req) => req.messages.filter((m) => m.role === "tool").map((m) => m.content);
const result = (evs: RunEvent[]) => evs.find((e): e is Extract<RunEvent, { type: "result" }> => e.type === "result");

test("loop: read -> edit -> finish changes the file and reports a diff", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "a.ts"), "const x = 1;\nconst y = 2;\n");
    const { svc, requests } = fakeProviders([
      { text: "Reading.", calls: [{ name: "read", args: { path: "a.ts" } }], usage: [100, 10] },
      { calls: [{ name: "edit", args: { path: "a.ts", old_string: "const y = 2;", new_string: "const y = 3;" } }] },
      { calls: [{ name: "finish", args: { summary: "changed y" } }] },
    ]);
    const evs = await run(f, svc).done;
    assert.equal(readFileSync(join(f.project, "a.ts"), "utf8"), "const x = 1;\nconst y = 3;\n");
    const diff = evs.find((e) => e.type === "diff");
    assert.deepEqual(diff && { file: diff.file, added: diff.added, removed: diff.removed }, { file: "a.ts", added: 1, removed: 1 });
    assert.match((diff as { patch?: string }).patch ?? "", /-const y = 2;\n\+const y = 3;/);
    const init = evs[0];
    assert.equal(init?.type, "init");
    assert.ok((init as { sessionId?: string }).sessionId);
    assert.deepEqual(
      evs.filter((e) => e.type === "tool" && e.phase === "start").map((e) => (e as { name: string }).name),
      ["read", "edit", "finish"],
    );
    assert.ok(evs.some((e) => e.type === "usage" && e.inputTokens === 100));
    assert.ok(evs.some((e) => e.type === "text" && e.text === "Reading."));
    const r = result(evs);
    assert.equal(r?.ok, true);
    assert.equal(r?.text, "changed y");
    // The system prompt carries the role, the rules, the skill catalog and the outcome rule.
    const sys = requests[0]?.messages[0]?.content ?? "";
    assert.match(sys, /You write code for one slice/);
    assert.match(sys, /Always be careful/);
    assert.match(sys, /- spec: Writes specs\./);
    assert.match(sys, /run report --outcome done\|review\|blocked\|needs-input/);
    assert.ok(!sys.includes("SPEC BODY"), "skill bodies load on demand only");
    assert.equal(requests[0]?.messages[0]?.content, requests[2]?.messages[0]?.content, "the system prompt is stable");
  } finally {
    f.cleanup();
  }
});

test("loop: edit without a read is refused (FS_NOT_OBSERVED)", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "a.ts"), "one\n");
    const { svc, requests } = fakeProviders([{ calls: [{ name: "edit", args: { path: "a.ts", old_string: "one", new_string: "two" } }] }, { text: "ok" }]);
    await run(f, svc).done;
    assert.equal(readFileSync(join(f.project, "a.ts"), "utf8"), "one\n");
    assert.match(toolResults(requests[1] as Req)[0] ?? "", /FS_NOT_OBSERVED/);
  } finally {
    f.cleanup();
  }
});

test("loop: an edit after the file changed on disk is refused (FS_STALE_VERSION)", async () => {
  const f = fixture();
  try {
    const file = join(f.project, "a.ts");
    writeFileSync(file, "one\n");
    const { svc, requests } = fakeProviders([
      { calls: [{ name: "read", args: { path: "a.ts" } }] },
      () => {
        writeFileSync(file, "one changed elsewhere\n");
        return { calls: [{ name: "edit", args: { path: "a.ts", old_string: "one", new_string: "two" } }] };
      },
      { text: "stopping" },
    ]);
    await run(f, svc).done;
    assert.equal(readFileSync(file, "utf8"), "one changed elsewhere\n");
    assert.match(toolResults(requests[2] as Req).at(-1) ?? "", /FS_STALE_VERSION/);
  } finally {
    f.cleanup();
  }
});

test("loop: shell asks the approval queue and a deny is respected", async () => {
  const f = fixture();
  try {
    const ran: string[] = [];
    const shell: ShellRunner = async (c) => {
      ran.push(c);
      return { code: 0, out: "hi\n", timedOut: false };
    };
    const { q, cards } = fakeQueue("deny");
    const { svc, requests } = fakeProviders([{ calls: [{ name: "shell", args: { command: "npm test" } }] }, { text: "ok" }]);
    const evs = await run(f, svc, { mode: "auto-review", queue: q, deps: { shell } }).done;
    assert.deepEqual(ran, []);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.tool, "Bash");
    assert.equal(cards[0]?.action, "shell");
    assert.equal(cards[0]?.detail, "npm test");
    assert.equal(cards[0]?.run_id, "run-test");
    assert.deepEqual(cards[0]?.actor, { kind: "agent", id: "builder", onBehalfOf: "sam" });
    assert.deepEqual(
      evs.filter((e) => e.type === "approval").map((e) => (e as { status: string }).status),
      ["pending", "denied"],
    );
    assert.match(toolResults(requests[1] as Req)[0] ?? "", /denied by sam/);

    // Allowed: the command runs. hl-only commands never ask.
    const allow = fakeQueue("allow");
    const p2 = fakeProviders([{ calls: [{ name: "shell", args: { command: "npm test" } }] }, { calls: [{ name: "shell", args: { command: "hl context" } }] }]);
    await run(f, p2.svc, { mode: "ask", queue: allow.q, deps: { shell } }).done;
    assert.deepEqual(ran, ["npm test", "hl context"]);
    assert.equal(allow.cards.length, 1);
    assert.match(toolResults(p2.requests[1] as Req)[0] ?? "", /exit code 0\nhi/);
  } finally {
    f.cleanup();
  }
});

test("loop: ask mode asks before an edit; auto-review edits inside cwd without asking", async () => {
  const f = fixture();
  try {
    const file = join(f.project, "a.ts");
    writeFileSync(file, "one\n");
    const script = (): Script => [
      { calls: [{ name: "read", args: { path: "a.ts" } }] },
      { calls: [{ name: "edit", args: { path: "a.ts", old_string: "one", new_string: "two" } }] },
      { text: "done" },
    ];
    const deny = fakeQueue("deny");
    await run(f, fakeProviders(script()).svc, { mode: "ask", queue: deny.q }).done;
    assert.equal(deny.cards[0]?.tool, "Edit");
    assert.equal(deny.cards[0]?.action, "edit file");
    assert.equal(readFileSync(file, "utf8"), "one\n");
    const none = fakeQueue("deny");
    await run(f, fakeProviders(script()).svc, { mode: "auto-review", queue: none.q }).done;
    assert.equal(none.cards.length, 0);
    assert.equal(readFileSync(file, "utf8"), "two\n");
  } finally {
    f.cleanup();
  }
});

test("loop: plan mode offers no write tools and refuses them", async () => {
  const f = fixture();
  try {
    const { svc, requests } = fakeProviders([{ calls: [{ name: "write", args: { path: "new.txt", content: "x" } }] }, { text: "plan written" }]);
    const evs = await run(f, svc, { mode: "plan" }).done;
    const names = (requests[0]?.tools ?? []).map((t) => t.name);
    for (const w of ["edit", "write", "shell"]) assert.ok(!names.includes(w), `${w} offered in plan mode`);
    for (const r of ["read", "glob", "grep", "hl", "todo_write", "skill", "ask_user", "finish"]) assert.ok(names.includes(r), `${r} missing`);
    assert.match(toolResults(requests[1] as Req)[0] ?? "", /NO_TOOL.*plan mode/);
    assert.equal(result(evs)?.ok, true);
  } finally {
    f.cleanup();
  }
});

test("loop: paths outside the work folders are refused", async () => {
  const f = fixture();
  try {
    const { svc, requests } = fakeProviders([
      { calls: [{ name: "read", args: { path: "../../../outside.txt" } }] },
      { calls: [{ name: "write", args: { path: join(f.base, "evil.txt"), content: "x" } }] },
      { text: "ok" },
    ]);
    await run(f, svc).done;
    assert.match(toolResults(requests[1] as Req)[0] ?? "", /PATH_OUTSIDE/);
    assert.match(toolResults(requests[2] as Req).at(-1) ?? "", /PATH_OUTSIDE/);
  } finally {
    f.cleanup();
  }
});

test("loop: protected knowledge-repo state is refused for write and edit", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "artifacts", "T-1"), { recursive: true });
    writeFileSync(join(f.root, "artifacts", "T-1", "ticket.toml"), 'id = "T-1"\n');
    const { svc, requests } = fakeProviders([
      { calls: [{ name: "read", args: { path: join(f.root, "artifacts", "T-1", "ticket.toml") } }] },
      { calls: [{ name: "write", args: { path: join(f.root, "artifacts", "T-1", "ticket.toml"), content: "hacked" } }] },
      { calls: [{ name: "write", args: { path: join(f.root, "workspace.toml"), content: "x" } }] },
      { text: "ok" },
    ]);
    await run(f, svc, { mode: "auto-review" }).done;
    assert.match(toolResults(requests[1] as Req).at(-1) ?? "", /^1\tid = "T-1"/);
    assert.match(toolResults(requests[2] as Req).at(-1) ?? "", /PROTECTED_PATH.*hl verb/);
    assert.match(toolResults(requests[3] as Req).at(-1) ?? "", /PROTECTED_PATH/);
    assert.equal(readFileSync(join(f.root, "artifacts", "T-1", "ticket.toml"), "utf8"), 'id = "T-1"\n');
  } finally {
    f.cleanup();
  }
});

test("loop: compaction prunes and summarises above 80% and keeps the last messages", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.project, "big.txt"),
      `${"big line ".repeat(12)}
`.repeat(200),
    );
    for (const n of [1, 2, 3, 4, 5])
      writeFileSync(
        join(f.project, `f${n}.txt`),
        `content of file ${n}
`,
      );
    const talk = (n: number) => `Step ${n} notes: ${"thinking about the design ".repeat(240)}`;
    const { svc, requests } = fakeProviders(
      [
        { calls: [{ name: "read", args: { path: "big.txt" } }] },
        ...[1, 2, 3, 4, 5].map((n) => ({ text: talk(n), calls: [{ name: "read", args: { path: `f${n}.txt` } }] })),
        { text: "LAST ANSWER" },
      ],
      { contextWindow: 10_000, summary: "SUMMARY: read big.txt and f1 to f4" },
    );
    const evs = await run(f, svc).done;
    const comp = evs.filter((e) => e.type === "compaction");
    assert.ok(comp.length >= 1, "a compaction event");
    for (const c of comp) assert.ok((c as { afterTokens: number }).afterTokens < (c as { beforeTokens: number }).beforeTokens);
    assert.ok(
      requests.some((r) => !r.tools),
      "the same model was asked for a summary",
    );
    const last = requests.filter((r) => r.tools).at(-1) as Req;
    assert.ok(last.messages[1]?.content.startsWith(SUMMARY_PREFIX), "history starts with the summary");
    assert.match(last.messages[1]?.content ?? "", /SUMMARY: read big.txt and f1 to f4/);
    // The latest messages are kept verbatim.
    assert.match(last.messages.at(-1)?.content ?? "", /content of file 5/);
    assert.equal(last.messages.at(-2)?.content, talk(5));
    assert.equal(result(evs)?.text, "LAST ANSWER");
    const sid = (evs[0] as { sessionId: string }).sessionId;
    const log = readFileSync(join(f.root, "runs", "loop-sessions", `${sid}.jsonl`), "utf8");
    assert.match(log, /"t":"prune"/);
    assert.match(log, /"t":"compact"/);
  } finally {
    f.cleanup();
  }
});

test("loop: a context-length error compacts and retries once", async () => {
  const f = fixture();
  try {
    const { svc, requests } = fakeProviders([
      { text: "first answer" },
      { throw: new ProviderError("context_exceeded", "maximum context length exceeded", { status: 400 }) },
      { text: "after compaction" },
    ]);
    const a = await run(f, svc, { prompt: "one" }).done;
    const sid = (a[0] as { sessionId: string }).sessionId;
    const b = await run(f, svc, { prompt: "two", resume: sid }).done;
    assert.equal(result(b)?.text, "after compaction");
    assert.ok(b.some((e) => e.type === "compaction"));
    assert.ok(requests.some((r) => !r.tools));
  } finally {
    f.cleanup();
  }
});

test("loop: resume continues the session from its log", async () => {
  const f = fixture();
  try {
    const { svc, requests } = fakeProviders([{ text: "first answer" }, { text: "second answer" }]);
    const a = await run(f, svc, { prompt: "first prompt" }).done;
    const sid = (a[0] as { sessionId: string }).sessionId;
    const b = await run(f, svc, { prompt: "second prompt", resume: sid }).done;
    assert.equal((b[0] as { sessionId: string }).sessionId, sid);
    assert.equal(result(b)?.sessionId, sid);
    const msgs = (requests[1] as Req).messages.slice(1).map((m) => `${m.role}:${m.content}`);
    assert.deepEqual(msgs, ["user:first prompt", "assistant:first answer", "user:second prompt"]);
    const log = readFileSync(join(f.root, "runs", "loop-sessions", `${sid}.jsonl`), "utf8");
    assert.match(log, /"t":"meta"/);
    // An unknown session starts fresh and says so.
    const c = await run(f, svc, { prompt: "third", resume: "ls-missing" }).done;
    assert.notEqual((c.find((e) => e.type === "init") as { sessionId: string }).sessionId, "ls-missing");
    assert.ok(c.some((e) => e.type === "stderr" && /not found/.test(e.text)));
  } finally {
    f.cleanup();
  }
});

test("loop: steer text is injected at the next step boundary", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "a.ts"), "x\n");
    let h: Harness | undefined;
    const { svc, requests } = fakeProviders([
      async () => {
        await h?.handle.steer?.("use tabs, not spaces");
        return { calls: [{ name: "read", args: { path: "a.ts" } }] };
      },
      { text: "ok" },
    ]);
    h = run(f, svc);
    await h.done;
    const m = (requests[1] as Req).messages;
    assert.equal(m.at(-1)?.role, "user");
    assert.equal(m.at(-1)?.content, "use tabs, not spaces");
    assert.equal(m.at(-2)?.role, "tool");
    await assert.rejects(() => (h as Harness).handle.steer?.("late") ?? Promise.resolve(), /ended/);
  } finally {
    f.cleanup();
  }
});

test("loop: a 429 is retried with backoff and logged as an event", async () => {
  const f = fixture();
  try {
    const waits: number[] = [];
    const { svc } = fakeProviders([{ throw: new ProviderError("rate_limit", "slow down", { status: 429, retryAfter: 2 }) }, { text: "fine" }]);
    const evs = await run(f, svc, { deps: { sleep: async (ms) => void waits.push(ms) } }).done;
    assert.deepEqual(waits, [2000]);
    const err = evs.find((e) => e.type === "error");
    assert.equal((err as { retryable?: boolean }).retryable, true);
    assert.match((err as { message: string }).message, /rate_limit.*retry 1\/3/);
    assert.equal(result(evs)?.ok, true);
    // A non-retryable failure ends the run with a failure class.
    const bad = fakeProviders([{ throw: new ProviderError("auth", "no key", { status: 401 }) }]);
    const evs2 = await run(f, bad.svc).done;
    assert.equal(result(evs2)?.ok, false);
    assert.equal(result(evs2)?.failureClass, "model-auth");
  } finally {
    f.cleanup();
  }
});

test("loop: repeated identical calls get a reminder at 3", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "a.ts"), "x\n");
    const same = { calls: [{ name: "read", args: { path: "a.ts" } }] };
    const { svc, requests } = fakeProviders([same, same, same, { text: "ok" }]);
    await run(f, svc).done;
    const before = (requests[2] as Req).messages.filter((m) => m.role === "user" && /repeating the exact same tool call/.test(m.content));
    const after = (requests[3] as Req).messages.filter((m) => m.role === "user" && /repeating the exact same tool call/.test(m.content));
    assert.equal(before.length, 0);
    assert.equal(after.length, 1);
  } finally {
    f.cleanup();
  }
});

test("loop: hl tool runs the verb in the knowledge root with --json and the run id; ask_user ends with needs-input", async () => {
  const f = fixture();
  try {
    const seen: { args: string[]; cwd: string; runId: string | undefined }[] = [];
    const hl: CommandRunner = async (args, o) => {
      seen.push({ args, cwd: o.cwd, runId: o.env.HL_RUN_ID });
      return { code: 0, out: '{"ok":true}', timedOut: false };
    };
    const { svc, requests } = fakeProviders([
      { calls: [{ name: "hl", args: { command: 'hl run report --outcome review --summary "look at it"' } }] },
      {
        calls: [
          { name: "todo_write", args: { items: [{ text: "a", status: "completed" }] } },
          { name: "skill", args: { name: "spec" } },
        ],
      },
      { calls: [{ name: "ask_user", args: { question: "Which port?" } }] },
    ]);
    const evs = await run(f, svc, { deps: { hl } }).done;
    assert.deepEqual(seen[0]?.args, ["run", "report", "--outcome", "review", "--summary", "look at it", "--json"]);
    assert.equal(seen[0]?.cwd, f.root);
    assert.equal(seen[0]?.runId, "run-test");
    assert.deepEqual((evs.find((e) => e.type === "todo") as { items: unknown }).items, [{ text: "a", status: "done" }]);
    assert.match(toolResults(requests[2] as Req).at(-1) ?? "", /SPEC BODY/);
    assert.equal(result(evs)?.text, "Which port?");
    assert.ok(!evs.some((e) => e.type === "outcome"), "no needs-input outcome after an explicit report");
  } finally {
    f.cleanup();
  }
});

test("loop: cancel stops the run; adapter test checks the model", async () => {
  const f = fixture();
  try {
    let h: Harness | undefined;
    const { svc } = fakeProviders([
      async () => {
        void h?.handle.cancel();
        return { calls: [{ name: "read", args: { path: "nope.txt" } }] };
      },
      { text: "never" },
    ]);
    h = run(f, svc);
    const evs = await h.done;
    assert.equal(result(evs)?.ok, false);
    assert.equal(result(evs)?.failureClass, "cancelled");

    const adapter = createLoopAdapter({ providers: () => svc, queue: () => undefined, root: f.root, deliveryRoot: f.delivery, protectedGlobs: [] });
    assert.equal(adapter.id, "loop");
    assert.deepEqual(adapter.capabilities, { resume: true, steer: true, approve: true, models: true });
    assert.equal((await adapter.test?.())?.ok, true);
    const bad = await adapter.test?.({ model: "nope/x" });
    assert.equal(bad?.ok, false);
    assert.match(bad?.checks.at(-1)?.message ?? "", /unknown model/);
  } finally {
    f.cleanup();
  }
});

test("loop: splitArgs handles quotes", () => {
  assert.deepEqual(splitArgs(`run report --summary "a \\"b\\" c" --next 'x y' ""`), ["run", "report", "--summary", 'a "b" c', "--next", "x y", ""]);
});

test("loop: glob and grep (rg from PATH, and the JS fallback) find files", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.project, "src"), { recursive: true });
    writeFileSync(join(f.project, "src", "a.ts"), "export const needle = 1;\n");
    writeFileSync(join(f.project, "src", "b.md"), "no\n");
    const realRg: CommandRunner = (args, o) => runProcess("rg", args, o);
    for (const deps of [{}, { rg: realRg }]) {
      const { svc, requests } = fakeProviders([
        {
          calls: [
            { name: "glob", args: { pattern: "**/*.ts" } },
            { name: "grep", args: { pattern: "needle" } },
          ],
        },
        { text: "ok" },
      ]);
      await run(f, svc, { deps }).done;
      const [g, r] = toolResults(requests[1] as Req);
      assert.equal(g, "src/a.ts");
      assert.match(r ?? "", /^src\/a\.ts:1:export const needle/);
    }
  } finally {
    f.cleanup();
  }
});
