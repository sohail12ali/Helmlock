// Milestone 3 stream W3: generated verb forms, settings, todos and the work log, with fetch mocked.
import type { SettingsView, TodoList, VerbCallResult, VerbInfo } from "@helmlock/core/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { coerce } from "@/components/forms/coerce";
import { VerbForm } from "@/components/forms/VerbForm";
import { sortTodos } from "@/pages/Todos";
import { renderApp } from "./render";
import { route } from "./server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const taskAdd: VerbInfo = {
  id: "task add",
  summary: "Add a task to a ticket.",
  examples: ['hl task add T-001-sa "Write the parser" --estimate 2'],
  writes: true,
  args: ["ticket", "title"],
  fields: [
    { key: "estimate", kind: "number", required: false, description: "hours" },
    { key: "title", kind: "string", required: true },
    { key: "ticket", kind: "string", required: true, description: "a ticket id" },
    { key: "ac", kind: "array", of: "string", required: false },
    { key: "slices", kind: "array", of: "number", required: false },
    { key: "urgent", kind: "boolean", required: false },
    { key: "size", kind: "string", required: false, choices: ["S", "M", "L"] },
  ],
};

const todos: TodoList = [
  { id: "TD-001-sa", text: "Ask about the tax rule", status: "open", priority: "normal", created: "2026-10-05T09:00:00Z", author: "sam", scope: "personal" },
  {
    id: "TD-002-sa",
    text: "Review CSV export",
    status: "open",
    priority: "high",
    due: "2026-10-01",
    ticket: "T-002-sa",
    created: "2026-10-06T09:00:00Z",
    author: "sam",
    scope: "team",
  },
];

const settings: SettingsView = {
  sections: [
    {
      id: "workspace",
      label: "Workspace and repos",
      plugins: [
        {
          plugin: "work-log",
          label: "Work log",
          fields: [
            { key: "day_hours", type: "number", label: "Day length (hours)", default: 8, scope: "workspace" },
            { key: "remind", type: "boolean", label: "Remind at session end", default: false, scope: "local" },
          ],
          values: { day_hours: { value: 8, source: "default" }, remind: { value: false, source: "default" } },
        },
      ],
    },
    {
      id: "agents",
      label: "Agents and backends",
      plugins: [
        {
          plugin: "runtime-claude",
          label: "Claude Code runtime",
          fields: [
            { key: "api_key_env", type: "secret-env", label: "API key variable", scope: "local" },
            { key: "mode", type: "select", label: "Mode", options: ["auto-review", "plan"], scope: "workspace" },
          ],
          values: { api_key_env: { value: "ANTHROPIC_API_KEY", source: "workspace.local.toml" }, mode: { value: "plan", source: "workspace.toml" } },
        },
      ],
    },
    { id: "models", label: "Models and providers", plugins: [] },
    { id: "permissions", label: "Permissions and approvals", plugins: [] },
    { id: "telegram", label: "Telegram", plugins: [] },
  ],
};

type Call = { path: string; headers: Record<string, string>; body: { input: Record<string, unknown>; dry_run?: boolean } };

/** Answers the fixture reads plus /verbs, /todos and /settings; records POSTs and answers them with `reply`. */
function mockServer(reply: (c: Call) => VerbCallResult = () => ({ ok: true, data: {}, text: "done" })) {
  const calls: Call[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const p = new URL(url, "http://localhost").pathname.replace(/^\/api\/v1/, "");
    if (init?.method === "POST") {
      const c: Call = { path: p, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      calls.push(c);
      const r = reply(c);
      return json(r, r.ok ? 200 : r.code === 2 ? 409 : 422);
    }
    if (p === "/verbs") return json({ ok: true, data: [taskAdd] });
    if (p === "/todos") return json({ ok: true, data: todos });
    if (p === "/settings") return json({ ok: true, data: settings });
    return route(url);
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

function renderForm(verb: VerbInfo) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VerbForm verb={verb} />
    </QueryClientProvider>,
  );
}

describe("VerbForm", () => {
  it("renders fields from VerbInfo (args first, required marked, description as hint)", () => {
    mockServer();
    renderForm(taskAdd);
    const labels = screen.getAllByText(/^(Ticket|Title|Estimate|Ac|Slices|Urgent|Size)$/).map((l) => l.textContent?.replace("*", ""));
    expect(labels.slice(0, 2)).toEqual(["Ticket", "Title"]);
    expect(screen.getByText("a ticket id")).toBeInTheDocument();
    expect(screen.getByLabelText(/Ticket/)).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("switch", { name: "Urgent" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText(/Size/))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["(default)", "S", "M", "L"]);
  });

  it("submits typed values: numbers as numbers, arrays split, booleans, with the write header", async () => {
    const calls = mockServer();
    renderForm(taskAdd);
    fireEvent.change(screen.getByLabelText(/Ticket/), { target: { value: "T-001-sa" } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Write the parser" } });
    fireEvent.change(screen.getByLabelText(/Estimate/), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText(/^Ac/), { target: { value: "AC-1\nAC-2, AC-3" } });
    fireEvent.change(screen.getByLabelText(/Slices/), { target: { value: "1, 2" } });
    fireEvent.click(screen.getByRole("switch", { name: "Urgent" }));
    fireEvent.change(screen.getByLabelText(/Size/), { target: { value: "M" } });
    fireEvent.click(screen.getByRole("button", { name: "Task add" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toBe("/verbs/task/add");
    expect(calls[0]!.headers["X-Helmlock-Request"]).toBe("1");
    expect(calls[0]!.body).toEqual({
      input: { ticket: "T-001-sa", title: "Write the parser", estimate: 2.5, ac: ["AC-1", "AC-2", "AC-3"], slices: [1, 2], urgent: true, size: "M" },
    });
    expect(await screen.findByText("done")).toBeInTheDocument();
  });

  it("blocks a missing required field without calling the server", async () => {
    const calls = mockServer();
    renderForm(taskAdd);
    fireEvent.click(screen.getByRole("button", { name: "Task add" }));
    expect(await screen.findByText("Ticket: required")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("Preview sends dry_run and says nothing was written", async () => {
    const calls = mockServer(() => ({ ok: true, data: {}, text: "would add task" }));
    renderForm(taskAdd);
    fireEvent.change(screen.getByLabelText(/Ticket/), { target: { value: "T-001-sa" } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.dry_run).toBe(true);
    expect(await screen.findByText(/Preview \(nothing written\)/)).toBeInTheDocument();
  });

  it("shows the error rule, message and fix inline", async () => {
    mockServer(() => ({ ok: false, code: 2, error: { rule: "gate-spec-frozen", message: "the spec is not frozen", fix: "freeze the spec first" } }));
    renderForm(taskAdd);
    fireEvent.change(screen.getByLabelText(/Ticket/), { target: { value: "T-001-sa" } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Task add" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Blocked: the spec is not frozen");
    expect(alert).toHaveTextContent("Fix: freeze the spec first");
    expect(alert).toHaveTextContent("gate-spec-frozen");
  });

  it("coerce reports bad numbers and leaves empty optionals out", () => {
    expect(coerce(taskAdd.fields, { ticket: "T", title: "t", estimate: "two" }).problems).toEqual({ estimate: '"two" is not a number' });
    expect(coerce(taskAdd.fields, { ticket: "T", title: "t", estimate: "", urgent: false }).input).toEqual({ ticket: "T", title: "t" });
  });
});

describe("settings", () => {
  it("renders F9a sections with source chips, scope notes and what is coming", async () => {
    mockServer();
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Workspace and repos" })).toBeInTheDocument();
    expect(screen.getByText(/provider layer arrives with the assistant/)).toBeInTheDocument();
    expect(screen.getByText(/channel milestone/)).toBeInTheDocument();
    expect(screen.getByText("workspace.local.toml")).toBeInTheDocument();
    expect(screen.getByText(/The secret itself stays in your environment/)).toBeInTheDocument();
    expect(screen.getAllByText(/shared with the team/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/this machine only/).length).toBeGreaterThan(0);
  });

  it("saves a shared number with config set (no local flag) and a local switch with local: true", async () => {
    const calls = mockServer(() => ({ ok: true, data: {}, text: "set work-log.day_hours" }));
    renderApp("/settings");
    const dayHours = await screen.findByLabelText("Day length (hours)");
    fireEvent.change(dayHours, { target: { value: "7.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Day length (hours)" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toBe("/verbs/config/set");
    expect(calls[0]!.headers["X-Helmlock-Request"]).toBe("1");
    expect(calls[0]!.body.input).toEqual({ plugin: "work-log", key: "day_hours", value: 7.5 });

    fireEvent.click(screen.getByRole("switch", { name: "Remind at session end" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body.input).toEqual({ plugin: "work-log", key: "remind", value: true, local: true });
  });

  it("a secret-env field saves only a variable name", async () => {
    const calls = mockServer();
    renderApp("/settings");
    const env = await screen.findByLabelText("API key variable");
    fireEvent.change(env, { target: { value: "sk-live 123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save API key variable" }));
    expect(await screen.findByText(/an environment variable name/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.change(env, { target: { value: "MY_KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Save API key variable" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.input).toEqual({ plugin: "runtime-claude", key: "api_key_env", value: "MY_KEY", local: true });
  });
});

describe("todos", () => {
  it("sorts open first, then due date, then priority", () => {
    expect(sortTodos(todos).map((t) => t.id)).toEqual(["TD-002-sa", "TD-001-sa"]);
  });

  it("lists todos with ticket link and due, adds one and checks one done", async () => {
    const calls = mockServer();
    renderApp("/todos");
    const list = await screen.findByTestId("todo-sections");
    expect(within(list).getByRole("link", { name: "T-002-sa" })).toBeInTheDocument();
    expect(within(list).getByText(/overdue/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Todo/), { target: { value: "Call the tax office" } });
    fireEvent.change(screen.getByLabelText("Ticket"), { target: { value: "T-004-sa" } });
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-10-09" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toBe("/verbs/todo/add");
    expect(calls[0]!.headers["X-Helmlock-Request"]).toBe("1");
    expect(calls[0]!.body.input).toEqual({ text: "Call the tax office", ticket: "T-004-sa", due: "2026-10-09", priority: "high", scope: "personal" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done: Ask about the tax rule" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.path).toBe("/verbs/todo/done");
    expect(calls[1]!.body.input).toEqual({ id: "TD-001-sa" });
  });

  it("filters to done and shows the empty state", async () => {
    mockServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/todos")) return json({ ok: true, data: url.includes("status=done") ? [] : todos });
        return route(url);
      }),
    );
    renderApp("/todos");
    await screen.findByTestId("todo-sections");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("No done todos yet.")).toBeInTheDocument();
  });
});

describe("work log", () => {
  it("counts characters live up to 160 and blocks longer text", async () => {
    mockServer();
    renderApp("/work");
    const text = await screen.findByLabelText(/What did you do/);
    fireEvent.change(text, { target: { value: "Wrote the parser" } });
    expect(screen.getByTestId("text-counter")).toHaveTextContent("16/160");
    fireEvent.change(text, { target: { value: "x".repeat(161) } });
    expect(screen.getByTestId("text-counter")).toHaveTextContent("161/160");
    expect(screen.getByRole("button", { name: "Log" })).toBeDisabled();
    expect(screen.getByText(/Shorten to 160 characters/)).toBeInTheDocument();
  });

  it("sends log-work with weight, and shows a skipped duplicate calmly", async () => {
    const calls = mockServer(() => ({
      ok: true,
      data: { written: false, reason: "duplicate" },
      text: "skipped (duplicate of an entry already logged today): T-001-sa  Development  Wrote the parser",
    }));
    renderApp("/work");
    fireEvent.change(await screen.findByLabelText(/^Ticket/), { target: { value: "T-001-sa" } });
    fireEvent.change(screen.getByLabelText(/What did you do/), { target: { value: "Wrote the parser" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Testing" } });
    fireEvent.change(screen.getByLabelText(/Weight/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toBe("/verbs/log-work");
    expect(calls[0]!.headers["X-Helmlock-Request"]).toBe("1");
    expect(calls[0]!.body.input).toEqual({ ticket: "T-001-sa", text: "Wrote the parser", category: "Testing", weight: 4 });
    const form = screen.getByRole("form", { name: "Log work" });
    expect(await within(form).findByRole("status")).toHaveTextContent("Skipped: duplicate.");
    expect(screen.queryByRole("alert")).toBeNull();
    // The sentence stays so it can be reworded.
    expect(screen.getByLabelText(/What did you do/)).toHaveValue("Wrote the parser");
  });

  it("sends hours for a fixed block and shows a server refusal inline", async () => {
    const calls = mockServer(() => ({
      ok: false,
      code: 1,
      error: { rule: "worklog-text", message: "the sentence names an agent (builder)", fix: "describe the work, not the tool" },
    }));
    renderApp("/work");
    fireEvent.change(await screen.findByLabelText(/What did you do/), { target: { value: "builder wrote the parser" } });
    fireEvent.click(screen.getByRole("button", { name: "Fixed hours" }));
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.input).toEqual({ ticket: "-", text: "builder wrote the parser", category: "Development", hours: 0.5 });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("names an agent");
    expect(alert).toHaveTextContent("worklog-text");
  });
});

describe("all actions", () => {
  it("lists console verbs and renders a generated form", async () => {
    mockServer();
    renderApp("/actions?verb=task%20add");
    expect(await screen.findByRole("button", { name: "task add" })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "Task add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("g then d and g then w still navigate", async () => {
    mockServer();
    renderApp("/");
    await screen.findByRole("list", { name: "Needs you" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "d" });
    expect(await screen.findByRole("heading", { name: "Todos" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "w" });
    expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
  });
});
