// Milestone 8 stream C: ticket thread, run timeline and the Crew page against the contract, fetch and EventSource faked.
import type { ApprovalCard, CrewView, ModelsView, NextStep, RunDiff, RunEventLine, RunState, TicketThread } from "@helmlock/core/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";
import { toolsLabel, toTimeline } from "./crew/timeline";
import { mentionAt } from "./thread/Composer";

// ---------- fakes ----------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
  static find(part: string): FakeEventSource | undefined {
    return [...FakeEventSource.instances].reverse().find((e) => e.url.includes(part) && e.readyState !== 2);
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown, status = 200) => json({ ok: true, data }, status);

type Handler = (url: URL, init?: RequestInit) => Response | undefined;
function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    return handler(u, init) ?? base(u, init) ?? route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const posts = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input).split("?")[0] === `/api/v1${path}`)
    .map(([, init]) => ({ body: JSON.parse(String(init!.body)), header: (init!.headers as Record<string, string>)["X-Helmlock-Request"] }));

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- data ----------

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const engines: CrewView["engines"] = [
  { id: "claude-code", label: "Claude Code", capabilities: { resume: true, steer: false, approve: true, models: true }, test: { ok: true, checks: [] } },
  { id: "loop", label: "Helmlock loop", capabilities: { resume: true, steer: true, approve: true, models: true }, test: { ok: true, checks: [] } },
  {
    id: "codex",
    label: "Codex",
    capabilities: { resume: false, steer: false, approve: false, models: false },
    test: { ok: false, checks: [{ level: "error", message: "codex is not on PATH" }] },
  },
];

const analystRun: RunState = {
  id: "r-0150",
  runtime: "loop",
  role: "analyst",
  model: "qwen3:14b",
  ticket: "T-001-sa",
  mode: "auto-review",
  status: "done",
  started: iso(NOW - 600_000),
  ended: iso(NOW - 300_000),
  outcome: { outcome: "done", summary: "Spec written, 4 rules, 6 criteria.", next: "write the plan", next_role: "planner" },
};

const builderRun: RunState = {
  id: "r-0151",
  runtime: "claude-code",
  role: "builder",
  model: "opus",
  ticket: "T-002-sa",
  mode: "auto-review",
  status: "running",
  started: iso(NOW - 240_000),
  capabilities: engines[0]!.capabilities,
};

const crew: CrewView = {
  roles: [
    { id: "analyst", label: "Analyst", engine: "loop", model: "qwen3:14b", worktree: false, engine_ok: true, current: [], last: analystRun },
    { id: "planner", label: "Planner", engine: "claude-code", model: "sonnet", worktree: false, engine_ok: true, current: [] },
    { id: "builder", label: "Builder", engine: "claude-code", model: "opus", worktree: true, engine_ok: true, current: [builderRun] },
    {
      id: "deployer",
      label: "Deployer",
      engine: "codex",
      worktree: false,
      engine_ok: false,
      engine_problem: "Engine test failed: codex is not on PATH",
      current: [],
    },
  ],
  engines,
  live: 1,
  max_live: 2,
  needs_you: [{ kind: "question", ticket: "T-004-sa", id: "Q-004-sa", title: "Question from analyst" }],
};

const next: NextStep = { role: "planner", label: "Planner plans", engine: "claude-code", model: "sonnet", reason: "The spec is frozen." };

const thread: TicketThread = {
  ticket: "T-001-sa",
  items: [
    { kind: "comment", ts: iso(NOW - 900_000), author: "sam", text: "Please keep the API backwards compatible." },
    { kind: "run", ts: iso(NOW - 600_000), run: analystRun },
    { kind: "comment", ts: iso(NOW - 300_000), author: "analyst", text: "OUTCOME COMMENT", run: "r-0150" },
  ],
  next,
};

const models: ModelsView = {
  providers: [{ id: "ollama", label: "Ollama (local)", base_url: "http://127.0.0.1:11434/v1", compat: {} }],
  models: [{ id: "qwen3:14b", provider: "ollama", label: "qwen3:14b", capabilities: { tool_calls: true, vision: false, streaming: true } }],
};

const approval: ApprovalCard = {
  id: "a-9",
  action: "Run a shell command",
  detail: "The builder wants to migrate the dev database.",
  tool: "Bash",
  input_preview: "pnpm db:migrate",
  actor: { kind: "agent", id: "builder", onBehalfOf: "sam" },
  run_id: "r-0151",
  local_only: true,
  created: iso(NOW - 10_000),
  expires: iso(NOW + 4 * 60_000),
  status: "pending",
};

/** Routes every milestone 8 test needs; a test's own handler wins. */
function base(u: URL, init?: RequestInit): Response | undefined {
  const p = u.pathname.replace(/^\/api\/v1/, "");
  const get = (init?.method ?? "GET") === "GET";
  if (get && p === "/crew") return ok(crew);
  if (get && p === "/models") return ok(models);
  if (get && p === "/approvals") return ok([]);
  if (get && p === "/tickets/T-001-sa/thread") return ok(thread);
  if (get && p === "/tickets/T-001-sa/next") return ok(next);
  if (get && p === "/runs/r-0151") return ok(builderRun);
  if (get && p === "/runs" && u.searchParams.get("role")) return ok([analystRun]);
  return undefined;
}

function emit(id: string, events: RunEventLine["event"][]) {
  const es = FakeEventSource.find(`/runs/${id}/events`)!;
  act(() => {
    es.open();
    for (const [i, event] of events.entries()) es.emit("event", { seq: i + 1, ts: iso(NOW), event });
  });
}

// ---------- ticket thread ----------

describe("ticket thread", () => {
  it("Next step hands off to the next role with the engine and model chosen on the chip", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-001-sa/handoff"
        ? ok({ ...analystRun, id: "r-0152", role: "planner", runtime: "loop", status: "running", outcome: undefined }, 201)
        : undefined,
    );
    renderApp("/t/T-001-sa");
    const button = await screen.findByRole("button", { name: "Next step: Planner plans" });
    expect(screen.getByText("The spec is frozen.")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^Engine: Claude Code/ }));
    const menu = screen.getByRole("group", { name: "Engine for this hand-off" });
    expect(within(menu).getByText("codex is not on PATH")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("radio", { name: /Helmlock loop/ }));
    const model = await within(menu).findByRole("combobox", { name: "Model" });
    await within(menu).findByRole("option", { name: /qwen3:14b/ });
    fireEvent.change(model, { target: { value: "qwen3:14b" } });
    fireEvent.click(within(menu).getByRole("button", { name: "Done" }));
    fireEvent.click(button);
    await waitFor(() => expect(posts(spy, "/tickets/T-001-sa/handoff")).toHaveLength(1));
    const call = posts(spy, "/tickets/T-001-sa/handoff")[0]!;
    expect(call.body).toEqual({ role: "planner", engine: "loop", model: "qwen3:14b" });
    expect(call.header).toBe("1");
    expect(await screen.findByText(/Planner started/)).toBeInTheDocument();
  });

  it("shows comments and runs in one thread, the outcome card with its next step, and no duplicate outcome comment", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-001-sa/handoff"
        ? ok({ ...analystRun, id: "r-0153", role: "planner", status: "queued" }, 201)
        : undefined,
    );
    renderApp("/t/T-001-sa?tab=thread");
    const list = await screen.findByRole("list", { name: "Thread" });
    expect(within(list).getByText("Please keep the API backwards compatible.")).toBeInTheDocument();
    expect(within(list).queryByText("OUTCOME COMMENT")).toBeNull();
    const run = within(list).getByRole("article", { name: "Run r-0150" });
    expect(run).toHaveTextContent("Analyst");
    expect(run).toHaveTextContent("Helmlock loop");
    const outcome = within(run).getByRole("region", { name: "Outcome" });
    expect(outcome).toHaveTextContent("Spec written, 4 rules, 6 criteria.");
    fireEvent.click(within(outcome).getByRole("button", { name: /Next: Planner write the plan/ }));
    await waitFor(() => expect(posts(spy, "/tickets/T-001-sa/handoff")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-001-sa/handoff")[0]!.body).toEqual({ role: "planner" });
  });

  it("the composer posts to say on Enter and shows what happened", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-001-sa/say"
        ? ok({ action: "queued", run: { ...analystRun, status: "running" } })
        : undefined,
    );
    renderApp("/t/T-001-sa?tab=thread");
    const box = await screen.findByRole("combobox", { name: "Message" });
    expect(box).toHaveAttribute("placeholder", "Message the analyst, or @planner ...");
    fireEvent.change(box, { target: { value: "Keep the old field names" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(posts(spy, "/tickets/T-001-sa/say")).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(posts(spy, "/tickets/T-001-sa/say")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-001-sa/say")[0]).toEqual({ body: { text: "Keep the old field names" }, header: "1" });
    expect(await screen.findByTestId("say-toast")).toHaveTextContent("Queued for the analyst's next turn.");
    expect(box).toHaveValue("");
  });

  it("@role autocompletes from the crew roles and hands off", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-001-sa/say"
        ? ok({ action: "handed-off", run: { ...builderRun, id: "r-0160", ticket: "T-001-sa" } })
        : undefined,
    );
    renderApp("/t/T-001-sa?tab=thread");
    const box = (await screen.findByRole("combobox", { name: "Message" })) as HTMLTextAreaElement;
    await waitFor(() => expect(box.placeholder).toContain("@planner"));
    fireEvent.change(box, { target: { value: "@bu", selectionStart: 3 } });
    const roles = screen.getByRole("listbox", { name: "Roles" });
    expect(
      within(roles)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["@builderBuilder"]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("@builder ");
    expect(screen.queryByRole("listbox", { name: "Roles" })).toBeNull();
    expect(posts(spy, "/tickets/T-001-sa/say")).toHaveLength(0);
    fireEvent.change(box, { target: { value: "@builder take slice 2", selectionStart: 21 } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(posts(spy, "/tickets/T-001-sa/say")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-001-sa/say")[0]!.body).toEqual({ text: "@builder take slice 2" });
    expect(await screen.findByTestId("say-toast")).toHaveTextContent("Handed off to the builder (r-0160).");
  });

  it("mentionAt finds the @query before the caret only", () => {
    expect(mentionAt("hi @ver", 7)).toEqual({ start: 3, query: "ver" });
    expect(mentionAt("mail@x", 6)).toBeNull();
    expect(mentionAt("@a b", 4)).toBeNull();
  });

  it("Reset session posts the last role and ticket", async () => {
    const spy = mockFetch((u, init) => (init?.method === "POST" && u.pathname === "/api/v1/sessions/reset" ? new Response(null, { status: 204 }) : undefined));
    renderApp("/t/T-001-sa?tab=thread");
    await screen.findByRole("list", { name: "Thread" });
    fireEvent.click(screen.getByRole("button", { name: "Ticket menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset session/ }));
    await waitFor(() => expect(posts(spy, "/sessions/reset")).toHaveLength(1));
    expect(posts(spy, "/sessions/reset")[0]!.body).toEqual({ role: "analyst", ticket: "T-001-sa" });
    expect(await screen.findByText("Session reset for the analyst.")).toBeInTheDocument();
  });

  it("the board drawer shows the thread with its composer", async () => {
    mockFetch(() => undefined);
    renderApp("/tickets?t=T-001-sa");
    const drawer = await screen.findByTestId("ticket-drawer");
    expect(await within(drawer).findByRole("button", { name: "Next step: Planner plans" })).toBeInTheDocument();
    fireEvent.mouseDown(within(drawer).getByRole("tab", { name: /Thread/ }));
    fireEvent.click(within(drawer).getByRole("tab", { name: /Thread/ }));
    expect(await within(drawer).findByRole("combobox", { name: "Message" })).toBeInTheDocument();
  });
});

// ---------- run timeline ----------

const timelineEvents: RunEventLine["event"][] = [
  { type: "init", model: "opus" },
  { type: "text", text: "Reading the code first." },
  { type: "tool", phase: "start", name: "Read", id: "1", input: { file_path: "src/a.ts" } },
  { type: "tool", phase: "end", name: "Read", id: "1" },
  { type: "tool", phase: "start", name: "Read", id: "2", input: { file_path: "src/b.ts" } },
  { type: "tool", phase: "end", name: "Read", id: "2" },
  { type: "tool", phase: "start", name: "Read", id: "3", input: { file_path: "src/c.ts" } },
  { type: "tool", phase: "end", name: "Read", id: "3" },
  { type: "tool", phase: "start", name: "Grep", id: "4", input: { pattern: "sync" } },
  { type: "tool", phase: "end", name: "Grep", id: "4" },
  { type: "tool", phase: "start", name: "Glob", id: "5", input: { pattern: "*.ts" } },
  { type: "tool", phase: "end", name: "Glob", id: "5" },
  { type: "tool", phase: "start", name: "Edit", id: "6", input: { file_path: "src/sync.ts" } },
  { type: "tool", phase: "end", name: "Edit", id: "6" },
  { type: "diff", file: "src/sync.ts", added: 12, removed: 3, patch: "--- a/src/sync.ts\n+++ b/src/sync.ts\n+const added = 1;\n-const gone = 0;" },
  { type: "tool", phase: "start", name: "Bash", id: "7", input: { command: "pnpm test" } },
  { type: "tool", phase: "end", name: "Bash", id: "7", isError: true },
  { type: "thinking", text: "The test failed on rounding." },
  {
    type: "todo",
    items: [
      { text: "Read the spec", status: "done" },
      { text: "Write the sync", status: "in_progress" },
      { text: "Update API docs", status: "pending" },
    ],
  },
  { type: "approval", id: "a-9", status: "pending", summary: "Run pnpm db:migrate" },
  { type: "message", text: "Use the v2 endpoint", by: "you", delivered: "queued" },
  { type: "compaction", beforeTokens: 120_000, afterTokens: 30_000 },
  { type: "usage", inputTokens: 30_000, outputTokens: 1_000, costUsd: 0.18 },
  { type: "outcome", outcome: { outcome: "done", summary: "Slice 1 built, 42 tests pass.", next: "verify slice 1", next_role: "verifier" } },
];

describe("run timeline", () => {
  it("groups tool calls, shows diffs that open, approvals inline, notices, the outcome and the side rail", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/approvals") return ok([approval]);
      if (init?.method === "POST" && u.pathname === "/api/v1/tickets/T-002-sa/handoff") return ok({ ...builderRun, id: "r-0170", role: "verifier" }, 201);
      return undefined;
    });
    renderApp("/runs/r-0151");
    await screen.findByRole("heading", { name: "r-0151" });
    await waitFor(() => expect(FakeEventSource.find("/runs/r-0151/events")).toBeDefined());
    emit("r-0151", timelineEvents);

    const tl = screen.getByTestId("run-timeline");
    const rows = [...tl.querySelectorAll('[data-row="tools"]')].map((r) => r.textContent);
    expect(rows).toEqual(["Read 3 files", "Searched 2 times", "Ran pnpm testfailed"]);
    // the edit tool is shown by its diff row; the failed command is marked
    expect(within(tl).queryByText(/^Edited 1 files|^Edited src/)).toBeNull();
    expect(within(tl).getByLabelText("failed")).toBeInTheDocument();
    const diff = within(tl).getByRole("button", { name: /Edited sync\.ts \+12 -3/ });
    expect(within(tl).queryByTestId("patch")).toBeNull();
    fireEvent.click(diff);
    expect(within(tl).getByTestId("patch")).toHaveTextContent("+const added = 1;");
    expect(within(tl).getByText("Thinking")).toBeInTheDocument();
    expect(within(tl).getByRole("region", { name: "Approval a-9" })).toHaveTextContent("pnpm db:migrate");
    expect(screen.getAllByRole("region", { name: "Approval a-9" })).toHaveLength(1);
    expect(tl.querySelector('[data-row="message"]')).toHaveTextContent("you, queued: Use the v2 endpoint");
    expect(tl.querySelector('[data-row="compaction"]')).toHaveTextContent("120k to 30k");

    const rail = screen.getByTestId("run-rail");
    expect(within(rail).getByRole("list", { name: "Todos" })).toHaveTextContent("Write the sync");
    expect(within(rail).getByRole("list", { name: "Files changed" })).toHaveTextContent("sync.ts +12 -3");
    expect(rail).toHaveTextContent("$0.18");

    const outcome = screen.getByRole("region", { name: "Outcome" });
    expect(outcome).toHaveTextContent("Slice 1 built, 42 tests pass.");
    fireEvent.click(within(outcome).getByRole("button", { name: /Next: Verifier verify slice 1/ }));
    await waitFor(() => expect(posts(spy, "/tickets/T-002-sa/handoff")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-002-sa/handoff")[0]!.body).toEqual({ role: "verifier" });

    // Claude Code cannot steer: the note is queued; Stop is there
    const gestures = screen.getByTestId("run-gestures");
    expect(within(gestures).queryByRole("form", { name: "Steer" })).toBeNull();
    expect(within(gestures).getByRole("form", { name: "Queue a note" })).toBeInTheDocument();
    expect(within(gestures).getByRole("button", { name: /Stop/ })).toBeInTheDocument();
  });

  it("offers Steer only when the engine can and the run is running", async () => {
    const steerable: RunState = { ...builderRun, runtime: "loop", capabilities: engines[1]!.capabilities };
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/runs/r-0151" && (init?.method ?? "GET") === "GET") return ok(steerable);
      if (init?.method === "POST" && u.pathname === "/api/v1/runs/r-0151/say") return ok({ delivered: "live" });
      return undefined;
    });
    renderApp("/runs/r-0151");
    const form = await screen.findByRole("form", { name: "Steer" });
    fireEvent.change(within(form).getByLabelText("Steer the run"), { target: { value: "use v2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(posts(spy, "/runs/r-0151/say")).toHaveLength(1));
    expect(posts(spy, "/runs/r-0151/say")[0]).toEqual({ body: { text: "use v2" }, header: "1" });
    expect(await screen.findByText("Delivered to the running agent.")).toBeInTheDocument();
  });

  it("a finished worktree run reviews its diff and merges after an in-page confirmation", async () => {
    const done: RunState = { ...builderRun, status: "done", ended: iso(NOW), worktree: { path: "D:/wt/T-002", branch: "hl/T-002-sa", repo: "wms-api" } };
    const diff: RunDiff = { files: [{ file: "src/sync.ts", added: 12, removed: 3 }], patch: "+line" };
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/runs/r-0151" && (init?.method ?? "GET") === "GET") return ok(done);
      if (u.pathname === "/api/v1/runs/r-0151/diff") return ok(diff);
      if (init?.method === "POST" && u.pathname === "/api/v1/runs/r-0151/merge") return ok({ merged: true, message: "Fast-forwarded main to hl/T-002-sa." });
      return undefined;
    });
    renderApp("/runs/r-0151");
    const wt = await screen.findByRole("region", { name: "Worktree" });
    expect(screen.queryByTestId("run-gestures")).toBeNull();
    fireEvent.click(within(wt).getByRole("button", { name: /Review diff/ }));
    expect(await within(wt).findByRole("list", { name: "Changed files" })).toHaveTextContent("src/sync.ts +12 -3");
    fireEvent.click(within(wt).getByRole("button", { name: "Merge" }));
    expect(posts(spy, "/runs/r-0151/merge")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Confirm merge" })).getByRole("button", { name: "Merge now" }));
    await waitFor(() => expect(posts(spy, "/runs/r-0151/merge")).toHaveLength(1));
    expect(await within(wt).findByText("Fast-forwarded main to hl/T-002-sa.")).toBeInTheDocument();
  });

  it("toTimeline folds tools by kind, keeps each command, and updates approvals in place", () => {
    const t = toTimeline(
      [
        { type: "tool", phase: "start", name: "Read", id: "a", input: { file_path: "x/one.ts" } },
        { type: "tool", phase: "end", name: "Read", id: "a" },
        { type: "tool", phase: "start", name: "Bash", id: "b", input: { command: "pnpm lint" } },
        { type: "tool", phase: "start", name: "Bash", id: "c", input: { command: "pnpm test" } },
        { type: "approval", id: "p", status: "pending", summary: "migrate" },
        { type: "approval", id: "p", status: "allowed", summary: "migrate" },
      ].map((event, i) => ({ seq: i + 1, event: event as RunEventLine["event"] })),
    );
    const labels = t.rows.map((r) => (r.kind === "tools" ? toolsLabel(r) : r.kind));
    expect(labels).toEqual(["Read one.ts", "Ran pnpm lint", "Ran pnpm test", "approval"]);
    expect(t.rows[3]).toMatchObject({ kind: "approval", status: "allowed" });
  });
});

// ---------- crew page ----------

/** A native drag of a ticket onto a role card, the way Pragmatic drag and drop sees it in a browser. */
function drag(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    data: {} as Record<string, string>,
    types: [] as string[],
    dropEffect: "none",
    effectAllowed: "all",
    items: [],
    files: [],
    setData(k: string, v: string) {
      this.data[k] = v;
      this.types.push(k);
    },
    getData(k: string) {
      return this.data[k] ?? "";
    },
    clearData() {},
    setDragImage() {},
  };
  fireEvent.dragStart(source, { dataTransfer, clientX: 5, clientY: 5 });
  fireEvent.dragEnter(target, { dataTransfer, clientX: 50, clientY: 50 });
  fireEvent.dragOver(target, { dataTransfer, clientX: 50, clientY: 50 });
  fireEvent.drop(target, { dataTransfer, clientX: 50, clientY: 50 });
}

describe("crew page", () => {
  it("shows the roles with engines, what each is doing, engine problems, the live count and Needs you", async () => {
    mockFetch((u) => (u.pathname === "/api/v1/approvals" ? ok([approval]) : undefined));
    renderApp("/crew");
    const roles = await screen.findByRole("list", { name: "Roles" });
    expect(within(roles).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByLabelText("Live runs")).toHaveTextContent("1 of 2 live runs");
    const builder = within(roles).getByRole("listitem", { name: "Builder role" });
    expect(builder).toHaveTextContent("Claude Code");
    expect(builder).toHaveTextContent("opus");
    expect(builder).toHaveTextContent(/running\s*T-002-sa\s*4 min/);
    expect(within(roles).getByRole("listitem", { name: "Analyst role" })).toHaveTextContent(/Idle, last: T-001-sa\s*done/);
    expect(within(roles).getByRole("listitem", { name: "Deployer role" })).toHaveTextContent("codex is not on PATH");
    const needs = await screen.findByRole("list", { name: "Needs you" });
    expect(within(needs).getByRole("link", { name: /Allow pnpm db:migrate/ })).toHaveAttribute("href", "/runs/r-0151");
    expect(within(needs).getByRole("link", { name: /Question from analyst/ })).toHaveAttribute("href", "/t/T-004-sa?tab=questions");
    // tickets with a live run are not offered; done tickets neither
    const toHand = await screen.findByRole("list", { name: "Tickets to hand over" });
    expect(toHand).not.toHaveTextContent("T-002-sa");
    expect(toHand).toHaveTextContent("T-003-sa");
  });

  it("the role panel saves engine, model and worktree with crew set and lists the role's runs", async () => {
    const spy = mockFetch((u, init) => (init?.method === "POST" && u.pathname === "/api/v1/verbs/crew/set" ? json({ ok: true, data: {} }) : undefined));
    renderApp("/crew");
    fireEvent.click(await screen.findByRole("button", { name: "Open Analyst" }));
    const panel = await screen.findByTestId("role-panel");
    expect(await within(panel).findByRole("list", { name: "Runs of Analyst" })).toHaveTextContent("r-0150");
    const form = within(panel).getByRole("form", { name: "Analyst settings" });
    expect(within(form).getByLabelText("Engine")).toHaveValue("loop");
    fireEvent.change(within(form).getByLabelText("Engine"), { target: { value: "claude-code" } });
    fireEvent.change(within(form).getByLabelText("Model"), { target: { value: "sonnet" } });
    fireEvent.click(within(form).getByRole("switch", { name: "Work in a git worktree" }));
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(spy, "/verbs/crew/set")).toHaveLength(1));
    expect(posts(spy, "/verbs/crew/set")[0]).toEqual({
      body: { input: { role: "analyst", engine: "claude-code", worktree: true, model: "sonnet" } },
      header: "1",
    });
    expect(await within(panel).findByText("Saved")).toBeInTheDocument();
  });

  it("dragging a ticket onto a role hands it over", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-003-sa/handoff"
        ? ok({ ...builderRun, id: "r-0180", ticket: "T-003-sa", role: "planner" }, 201)
        : undefined,
    );
    renderApp("/crew");
    const toHand = await screen.findByRole("list", { name: "Tickets to hand over" });
    const card = toHand.querySelector('[data-ticket="T-003-sa"]') as HTMLElement;
    const planner = screen.getByRole("listitem", { name: "Planner role" });
    await act(async () => drag(card, planner));
    await waitFor(() => expect(posts(spy, "/tickets/T-003-sa/handoff")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-003-sa/handoff")[0]!.body).toEqual({ role: "planner" });
    await waitFor(() => expect(screen.getAllByRole("status").some((s) => /Planner took T-003-sa/.test(s.textContent ?? ""))).toBe(true));
  });

  it("Hand over… does the same from the keyboard", async () => {
    const spy = mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/tickets/T-001-sa/handoff" ? ok({ ...analystRun, id: "r-0181", status: "queued" }, 201) : undefined,
    );
    renderApp("/crew");
    fireEvent.click(await screen.findByRole("button", { name: "Hand over T-001-sa" }));
    const form = screen.getByRole("form", { name: "Hand over T-001-sa" });
    // the stage's agent is the default role (spec -> analyst)
    expect(within(form).getByLabelText("Role for T-001-sa")).toHaveValue("analyst");
    fireEvent.change(within(form).getByLabelText("Role for T-001-sa"), { target: { value: "builder" } });
    fireEvent.click(within(form).getByRole("button", { name: "Hand over" }));
    await waitFor(() => expect(posts(spy, "/tickets/T-001-sa/handoff")).toHaveLength(1));
    expect(posts(spy, "/tickets/T-001-sa/handoff")[0]!.body).toEqual({ role: "builder" });
  });

  it("the old Agents and chat route redirects to Crew and the nav says Crew", async () => {
    mockFetch(() => undefined);
    renderApp("/agents");
    expect(await screen.findByRole("heading", { name: "Crew" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Crew" })).toHaveAttribute("href", "/crew");
    expect(within(nav).queryByText("Agents and chat")).toBeNull();
  });
});
