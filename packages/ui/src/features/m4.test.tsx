// Milestone 4 stream A4: runs, approvals and the assistant chat against the contract, with fetch and EventSource faked.
import type { ApprovalCard, ChatDetail, ChatEvent, ModelProbe, ModelsView, RunDetail, RunEventLine } from "@helmlock/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";
import { toTranscript } from "./agents/run-flags";
import { MicButton } from "./chat/MicButton";
import { groupModels, ModelPicker } from "./chat/ModelPicker";
import { ModelsTest } from "./chat/ModelsTest";

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
    return handler(u, init) ?? route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const calls = (spy: ReturnType<typeof mockFetch>, method: string, path: string) =>
  spy.mock.calls.filter(([input, init]) => (init?.method ?? "GET") === method && String(input).split("?")[0] === `/api/v1${path}`);

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

const running: RunDetail = {
  id: "r-0100",
  runtime: "claude-code",
  agent: "analyst",
  ticket: "T-001-sa",
  mode: "plan",
  status: "running",
  started: iso(NOW - 30_000),
};

const runCard: ApprovalCard = {
  id: "a-1",
  action: "Run a shell command",
  detail: "The analyst wants to list the artifacts folder.",
  tool: "Bash",
  input_preview: "ls artifacts/T-001-sa",
  actor: { kind: "agent", id: "analyst", onBehalfOf: "sam" },
  run_id: "r-0100",
  local_only: true,
  created: iso(NOW - 10_000),
  expires: iso(NOW + 4 * 60_000),
  status: "pending",
};

const models: ModelsView = {
  providers: [
    { id: "ollama", label: "Ollama (local)", base_url: "http://127.0.0.1:11434/v1", compat: {} },
    { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_env: "OPENROUTER_API_KEY", compat: {} },
  ],
  models: [
    { id: "qwen3:14b", provider: "ollama", label: "qwen3:14b", capabilities: { tool_calls: true, vision: false, streaming: true } },
    { id: "llava", provider: "ollama", label: "llava", capabilities: { tool_calls: false, vision: true, streaming: true } },
    { id: "anthropic/claude-sonnet", provider: "openrouter", label: "Claude Sonnet", capabilities: { tool_calls: true, vision: true, streaming: true } },
  ],
  default: "qwen3:14b",
};

const chatDetail: ChatDetail = {
  summary: { id: "c-1", title: "Spec for T-001", model: "qwen3:14b", channel: "console", created: iso(NOW - 60_000), updated: iso(NOW - 60_000) },
  messages: [],
};

// ---------- runs ----------

describe("agent runs", () => {
  it("start run posts RunStart with the write header and opens the run view", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/runs" && init?.method === "POST") return ok(running, 201);
      if (u.pathname === "/api/v1/runs/r-0100") return ok(running);
      return undefined;
    });
    renderApp("/agents");
    const form = await screen.findByRole("form", { name: "Start a run" }, { timeout: 10_000 }); // lazy page: allow for a slow first load
    fireEvent.change(within(form).getByLabelText("Task"), { target: { value: "Draft the spec" } });
    fireEvent.change(within(form).getByLabelText("Ticket"), { target: { value: "T-001-sa" } });
    fireEvent.change(within(form).getByLabelText("Mode"), { target: { value: "ask" } });
    fireEvent.click(within(form).getByRole("button", { name: /start run/i }));

    await waitFor(() => expect(calls(spy, "POST", "/runs")).toHaveLength(1));
    const [, init] = calls(spy, "POST", "/runs")[0]!;
    expect((init!.headers as Record<string, string>)["X-Helmlock-Request"]).toBe("1");
    expect(JSON.parse(String(init!.body))).toEqual({ task: "Draft the spec", runtime: "claude-code", mode: "ask", agent: "analyst", ticket: "T-001-sa" });
    expect(await screen.findByRole("heading", { name: "r-0100" })).toBeInTheDocument();
  });

  it("lists runs active first with the recovery badge", async () => {
    mockFetch((u) => {
      if (u.pathname === "/api/v1/runs")
        return ok([
          {
            id: "r-1",
            runtime: "claude-code",
            agent: "builder",
            mode: "plan",
            started: iso(NOW - 600_000),
            ended: iso(NOW - 500_000),
            ok: false,
            failure_class: "stalled",
          },
          { id: "r-2", runtime: "claude-code", agent: "analyst", mode: "plan", started: iso(NOW - 900_000) },
        ]);
      return undefined;
    });
    renderApp("/agents");
    const list = await screen.findByRole("list", { name: "Runs" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("r-2");
    expect(rows[0]).toHaveTextContent("running");
    expect(rows[1]).toHaveTextContent("Recovery needed");
  });

  it("run view renders streamed events and cancels through an in-page confirmation", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/runs/r-0100/cancel" && init?.method === "POST") return ok({ ...running, status: "cancelled", ended: iso(Date.now()) });
      if (u.pathname === "/api/v1/runs/r-0100") return ok(running);
      if (u.pathname === "/api/v1/approvals") return ok([runCard]);
      return undefined;
    });
    renderApp("/agents/runs/r-0100");
    await screen.findByRole("heading", { name: "r-0100" });
    await waitFor(() => expect(FakeEventSource.find("/runs/r-0100/events")).toBeDefined());
    const es = FakeEventSource.find("/runs/r-0100/events")!;
    const lines: RunEventLine[] = [
      { seq: 1, ts: iso(NOW), event: { type: "init", model: "sonnet" } },
      { seq: 2, ts: iso(NOW), event: { type: "thinking", text: "Look at the spec first." } },
      { seq: 3, ts: iso(NOW), event: { type: "text", text: "Reading the " } },
      { seq: 4, ts: iso(NOW), event: { type: "text", text: "ticket folder." } },
      { seq: 5, ts: iso(NOW), event: { type: "tool", phase: "start", name: "Read", id: "t1", input: { file_path: "artifacts/T-001-sa/spec.md" } } },
      { seq: 6, ts: iso(NOW), event: { type: "tool", phase: "end", name: "Read", id: "t1" } },
      { seq: 7, ts: iso(NOW), event: { type: "usage", inputTokens: 12_000, outputTokens: 800, costUsd: 0.05 } },
      { seq: 7, ts: iso(NOW), event: { type: "text", text: "DUPLICATE" } },
      { seq: 8, ts: iso(NOW), event: { type: "result", ok: true, text: "Spec drafted." } },
    ];
    act(() => {
      es.open();
      for (const l of lines) es.emit("event", l);
    });
    const transcript = screen.getByTestId("run-transcript");
    expect(within(transcript).getByText("Reading the ticket folder.")).toBeInTheDocument();
    expect(within(transcript).getByText("Thinking")).toBeInTheDocument();
    expect(within(transcript).getByText("artifacts/T-001-sa/spec.md")).toBeInTheDocument();
    expect(within(transcript).getByTestId("run-result")).toHaveTextContent("Spec drafted.");
    expect(within(transcript).queryByText("DUPLICATE")).toBeNull();
    expect(transcript).toHaveTextContent("usage 12k in / 800 out");
    // the run's pending approval shows in the run view
    expect(await screen.findByRole("region", { name: "Approval a-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
    const confirm = screen.getByRole("alertdialog", { name: "Confirm cancel" });
    expect(calls(spy, "POST", "/runs/r-0100/cancel")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Stop run" }));
    await waitFor(() => expect(calls(spy, "POST", "/runs/r-0100/cancel")).toHaveLength(1));
    const [, init] = calls(spy, "POST", "/runs/r-0100/cancel")[0]!;
    expect((init!.headers as Record<string, string>)["X-Helmlock-Request"]).toBe("1");
    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel run/i })).toBeNull());
  });

  it("folds tool start and end into one line", () => {
    const items = toTranscript([
      { seq: 1, event: { type: "tool", phase: "start", name: "Bash", id: "x", input: { command: "ls" } } },
      { seq: 2, event: { type: "tool", phase: "end", name: "Bash", id: "x", isError: true } },
    ]);
    expect(items).toEqual([{ kind: "tool", seq: 1, name: "Bash", input: { command: "ls" }, done: true, isError: true }]);
  });
});

// ---------- approvals ----------

describe("approvals", () => {
  it("shows pending cards on Overview and in the top bar, and posts ApprovalAnswer", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/approvals" && (init?.method ?? "GET") === "GET") return ok([runCard]);
      if (u.pathname === "/api/v1/approvals/a-1" && init?.method === "POST")
        return ok({ ...runCard, status: "allowed", scope: "chat", decided_by: "sam", decided_via: "console" });
      return undefined;
    });
    renderApp("/");
    const card = await screen.findByRole("region", { name: "Approval a-1" });
    expect(card).toHaveTextContent("ls artifacts/T-001-sa");
    expect(card).toHaveTextContent("Local only");
    expect(within(card).getByLabelText("Time left").textContent).toMatch(/^[34]:\d\d$/);
    expect(screen.getByRole("link", { name: "1 approval waiting" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Allow for this run" }));
    await waitFor(() => expect(calls(spy, "POST", "/approvals/a-1")).toHaveLength(1));
    const [, init] = calls(spy, "POST", "/approvals/a-1")[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ decision: "allow", scope: "chat" });
    expect((init!.headers as Record<string, string>)["X-Helmlock-Request"]).toBe("1");
  });

  it("deny posts decision deny without a scope", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/approvals" && (init?.method ?? "GET") === "GET") return ok([runCard]);
      if (u.pathname === "/api/v1/approvals/a-1" && init?.method === "POST") return ok({ ...runCard, status: "denied", decided_by: "sam" });
      return undefined;
    });
    renderApp("/inbox");
    const card = await screen.findByRole("region", { name: "Approval a-1" });
    fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(calls(spy, "POST", "/approvals/a-1")).toHaveLength(1));
    expect(JSON.parse(String(calls(spy, "POST", "/approvals/a-1")[0]![1]!.body))).toEqual({ decision: "deny" });
  });
});

// ---------- chat ----------

describe("assistant chat", () => {
  const chatRoutes =
    (extra?: Handler): Handler =>
    (u, init) => {
      const r = extra?.(u, init);
      if (r) return r;
      if (u.pathname === "/api/v1/models") return ok(models);
      if (u.pathname === "/api/v1/chats" && (init?.method ?? "GET") === "GET") return ok([chatDetail.summary]);
      if (u.pathname === "/api/v1/chats/c-1") return ok(chatDetail);
      if (u.pathname === "/api/v1/chats/c-1/messages" && init?.method === "POST") return new Response(null, { status: 202 });
      if (u.pathname === "/api/v1/approvals") return ok([]);
      return undefined;
    };

  it("sends the text and renders deltas, a permission card and an error from ChatEvent frames", async () => {
    const spy = mockFetch(chatRoutes());
    renderApp("/chat");
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(FakeEventSource.find("/chats/c-1/events")).toBeDefined());
    fireEvent.change(box, { target: { value: "Move T-001 to plan" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(calls(spy, "POST", "/chats/c-1/messages")).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(calls(spy, "POST", "/chats/c-1/messages")).toHaveLength(1));
    const [, init] = calls(spy, "POST", "/chats/c-1/messages")[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ text: "Move T-001 to plan" });
    expect((init!.headers as Record<string, string>)["X-Helmlock-Request"]).toBe("1");

    const es = FakeEventSource.find("/chats/c-1/events")!;
    const frames: ChatEvent[] = [
      { type: "message", message: { id: "u-1", role: "user", text: "Move T-001 to plan", ts: iso(NOW) } },
      { type: "delta", message_id: "m-1", text: "I can do " },
      { type: "delta", message_id: "m-1", text: "that." },
      {
        type: "message",
        message: {
          id: "m-2",
          role: "tool",
          text: "",
          ts: iso(NOW),
          tool: { name: "verb.run", input: { command: "hl ticket move T-001 plan" }, status: "proposed", approval_id: "a-2" },
        },
      },
      { type: "approval", card: { ...runCard, id: "a-2", run_id: undefined, chat_id: "c-1", tool: "verb.run", input_preview: "hl ticket move T-001 plan" } },
      { type: "error", code: "rate_limit", message: "The provider is rate limiting." },
    ];
    act(() => {
      es.open();
      for (const f of frames) es.emit("assistant", f);
    });
    const list = screen.getByTestId("chat-messages");
    expect(within(list).getAllByText("Move T-001 to plan")).toHaveLength(1);
    expect(within(list).getByText("I can do that.")).toBeInTheDocument();
    expect(list.querySelector('[data-tool="verb.run"]')).not.toBeNull();
    const card = within(list).getByRole("region", { name: "Approval a-2" });
    expect(within(card).getByRole("button", { name: "Allow for this chat" })).toBeInTheDocument();
    expect(within(list).getByRole("alert")).toHaveTextContent("rate_limit");
  });

  it("shows the no-model empty state linking to Settings > Models", async () => {
    mockFetch(chatRoutes((u) => (u.pathname === "/api/v1/models" ? ok({ providers: [], models: [] }) : undefined)));
    renderApp("/chat");
    expect(await screen.findByText("No model configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings > Models" })).toHaveAttribute("href", "/settings#settings-models");
  });

  it("toggles the chat panel from the top bar", async () => {
    mockFetch(chatRoutes());
    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "Open assistant" }));
    expect(await screen.findByRole("region", { name: "Assistant" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
  });

  it("model picker groups by provider and marks the default", () => {
    expect(groupModels(models).map((g) => [g.label, g.models.map((m) => m.id)])).toEqual([
      ["Ollama (local)", ["qwen3:14b", "llava"]],
      ["OpenRouter", ["anthropic/claude-sonnet"]],
    ]);
    const onChange = vi.fn();
    const { container } = render(<ModelPicker view={models} value="qwen3:14b" onChange={onChange} />);
    const groups = [...container.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Ollama (local)", "OpenRouter"]);
    expect(screen.getByRole("option", { name: "qwen3:14b (default)" })).toBeInTheDocument();
    expect(screen.getByText("tools")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llava" } });
    expect(onChange).toHaveBeenCalledWith("llava");
  });

  it("mic button is absent without SpeechRecognition and present with it", () => {
    const { unmount } = render(<MicButton onText={() => {}} />);
    expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
    unmount();
    const start = vi.fn();
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class {
        start = start;
        stop() {}
      },
    );
    render(<MicButton onText={() => {}} />);
    const btn = screen.getByRole("button", { name: "Dictate" });
    expect(btn.getAttribute("title")).toMatch(/vendor/);
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("Test connection posts the provider and shows the ProbeResult", async () => {
    const probe: ModelProbe = { provider: "ollama", reachable: true, models: ["qwen3:14b"], chat: true, streaming: true, tool_calls: false };
    const spy = mockFetch(chatRoutes((u, init) => (u.pathname === "/api/v1/models/test" && init?.method === "POST" ? ok(probe) : undefined)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ModelsTest />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByTestId("probe-result")).toHaveTextContent("tool calls no");
    expect(JSON.parse(String(calls(spy, "POST", "/models/test")[0]![1]!.body))).toEqual({ provider: "ollama" });
  });
});
