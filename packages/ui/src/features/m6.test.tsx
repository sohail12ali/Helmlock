// Milestone 6 stream P3: people and storage scopes in the console, against the contract with fetch mocked.
import type { ChatDetail, ModelsView, PeopleView, TodoList } from "@helmlock/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialsOf, slugify } from "@/api/m6";
import { filterTodos, groupTodos } from "@/pages/Todos";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";

class FakeEventSource {
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });
const verbOk = (text = "Done.") => json({ ok: true, data: {}, text });

type Handler = (url: URL, init?: RequestInit) => Response | undefined;
function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    if (init?.method === "POST" && u.pathname.startsWith("/api/v1/verbs/")) return verbOk();
    return handler(u, init) ?? route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const verbCalls = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input) === `/api/v1/verbs/${path}`)
    .map(([, init]) => ({
      input: (JSON.parse(String(init!.body)) as { input: Record<string, unknown> }).input,
      headers: init!.headers as Record<string, string>,
    }));
const gets = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls.filter(([input, init]) => (init?.method ?? "GET") === "GET" && String(input).split("?")[0] === `/api/v1${path}`).map(([i]) => String(i));

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// ---------- data ----------

const people: PeopleView = {
  me: { id: "sam", name: "Sam Ali", initials: "SA" },
  people: [
    { id: "sam", name: "Sam Ali", initials: "SA", role: "lead", git: ["Sam Ali", "sam@example.com"] },
    { id: "rina", name: "Rina Kay", initials: "RK", git: [] },
  ],
  unknown_git: [{ name: "Noble Wave", email: "noble@example.com", commits: 12 }],
};

const base = { status: "open" as const, priority: "normal", created: "2026-10-05T09:00:00Z" };
const todos: TodoList = [
  { ...base, id: "TD-001-sa", text: "Team standup notes", author: "sam", scope: "team" },
  { ...base, id: "TD-002-sa", text: "My own follow-up", author: "sam", scope: "personal" },
  { ...base, id: "TD-003-sa", text: "Secret draft", author: "sam", scope: "private" },
];
const others: TodoList = [{ ...base, id: "TD-004-rk", text: "Rina's thing", author: "rina", scope: "personal" }];

const todoRoutes =
  (p: PeopleView | null = people): Handler =>
  (u) => {
    if (u.pathname === "/api/v1/people") return p ? ok(p) : json({ ok: false, error: { rule: "not-found", message: "no" } }, 404);
    if (u.pathname === "/api/v1/todos") return ok(u.searchParams.get("all") === "true" ? [...todos, ...others] : todos);
    return undefined;
  };

// ---------- scopes and todos ----------

describe("todo scopes", () => {
  it("filters Team / Mine / Private / Everyone's and groups by scope", () => {
    const all = [...todos, ...others];
    const ids = (f: Parameters<typeof filterTodos>[1]) => filterTodos(all, f, "sam").map((t) => t.id);
    expect(ids("all")).toEqual(["TD-001-sa", "TD-002-sa", "TD-003-sa"]);
    expect(ids("team")).toEqual(["TD-001-sa"]);
    expect(ids("mine")).toEqual(["TD-002-sa", "TD-003-sa"]);
    expect(ids("private")).toEqual(["TD-003-sa"]);
    expect(ids("everyone")).toEqual(["TD-001-sa", "TD-002-sa", "TD-003-sa", "TD-004-rk"]);
    expect(groupTodos(all, "sam").map((s) => s.id)).toEqual(["team", "personal", "private", "others"]);
    // Without a known "me", every personal todo the server returns counts as yours.
    expect(filterTodos(all, "mine", undefined).map((t) => t.id)).toContain("TD-004-rk");
  });

  it("adds with the picked scope (default Personal) and shows where it is stored", async () => {
    const spy = mockFetch(todoRoutes());
    renderApp("/todos");
    await screen.findByRole("list", { name: "Team todos" });
    const group = screen.getByRole("group", { name: "Keep this todo" });
    expect(within(group).getByRole("radio", { name: /Personal/ })).toBeChecked();
    const form = screen.getByRole("form", { name: "Add a todo" });
    expect(within(form).getByText(/in git under people\/sam\//)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Todo/), { target: { value: "Plan the offsite" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(verbCalls(spy, "todo/add")).toHaveLength(1));
    expect(verbCalls(spy, "todo/add")[0]!.input).toEqual({ text: "Plan the offsite", scope: "personal" });

    fireEvent.click(within(group).getByRole("radio", { name: /Private/ }));
    expect(within(form).getByText(/Only on this machine \(\.hl-local\/\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Todo/), { target: { value: "Gift idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(verbCalls(spy, "todo/add")).toHaveLength(2));
    expect(verbCalls(spy, "todo/add")[1]!.input).toEqual({ text: "Gift idea", scope: "private" });
    expect(verbCalls(spy, "todo/add")[1]!.headers["X-Helmlock-Request"]).toBe("1");
  });

  it("shows a scope badge per row and moves a todo with todo move", async () => {
    const spy = mockFetch(todoRoutes());
    renderApp("/todos");
    const personal = await screen.findByRole("list", { name: "Personal todos" });
    const row = within(personal).getByText("My own follow-up").closest("li")!;
    expect(row.querySelector('[data-scope="personal"]')).not.toBeNull();
    fireEvent.change(within(personal).getByRole("combobox", { name: "Move to…: My own follow-up" }), { target: { value: "team" } });
    await waitFor(() => expect(verbCalls(spy, "todo/move")).toHaveLength(1));
    expect(verbCalls(spy, "todo/move")[0]!.input).toEqual({ id: "TD-002-sa", scope: "team" });
  });

  it("filter chips switch sections; Everyone's asks for all and shows others read-only", async () => {
    const spy = mockFetch(todoRoutes());
    renderApp("/todos");
    await screen.findByRole("list", { name: "Team todos" });
    const chips = screen.getByRole("group", { name: "Whose todos" });

    fireEvent.click(within(chips).getByRole("button", { name: "Mine" }));
    expect(screen.queryByRole("list", { name: "Team todos" })).toBeNull();
    expect(screen.getByRole("list", { name: "Personal todos" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Private todos" })).toBeInTheDocument();

    fireEvent.click(within(chips).getByRole("button", { name: "Private" }));
    expect(screen.queryByRole("list", { name: "Personal todos" })).toBeNull();

    fireEvent.click(within(chips).getByRole("button", { name: "Everyone's" }));
    const othersList = await screen.findByRole("list", { name: "Other people's personal todos" });
    expect(gets(spy, "/todos").some((u) => u.includes("all=true"))).toBe(true);
    expect(within(othersList).getByText("Rina Kay · Personal")).toBeInTheDocument();
    expect(within(othersList).getByRole("checkbox", { name: /read-only/ })).toBeDisabled();
    expect(within(othersList).queryByRole("combobox")).toBeNull();
  });
});

// ---------- chat share and run attach ----------

const models: ModelsView = {
  providers: [{ id: "ollama", label: "Ollama", base_url: "http://127.0.0.1:11434/v1", compat: {} }],
  models: [{ id: "qwen3:14b", provider: "ollama", label: "qwen3:14b", capabilities: { tool_calls: true, vision: false, streaming: true } }],
  default: "qwen3:14b",
};
const chat: ChatDetail = {
  summary: { id: "c-1", title: "Spec talk", model: "qwen3:14b", channel: "console", created: "2026-10-07T09:00:00Z", updated: "2026-10-07T09:00:00Z" },
  messages: [],
};

describe("chat share", () => {
  const chatRoutes =
    (shared: boolean): Handler =>
    (u, init) => {
      const summary = { ...chat.summary, shared };
      if (u.pathname === "/api/v1/people") return ok(people);
      if (u.pathname === "/api/v1/models") return ok(models);
      if (u.pathname === "/api/v1/chats" && (init?.method ?? "GET") === "GET") return ok([summary]);
      if (u.pathname === "/api/v1/chats/c-1") return ok({ ...chat, summary });
      if (u.pathname === "/api/v1/approvals") return ok([]);
      return undefined;
    };

  it("explains what sharing does, then posts chat share", async () => {
    const spy = mockFetch(chatRoutes(false));
    renderApp("/chat");
    fireEvent.click(await screen.findByRole("button", { name: "Share this chat" }));
    const panel = screen.getByRole("alertdialog", { name: "Share this chat" });
    expect(within(panel).getByText("people/sam/chats/")).toBeInTheDocument();
    expect(panel).toHaveTextContent(/visible to the team/);
    expect(panel).toHaveTextContent(/files the assistant read are stripped/);
    expect(verbCalls(spy, "chat/share")).toHaveLength(0);
    fireEvent.click(within(panel).getByRole("button", { name: "Share with the team" }));
    await waitFor(() => expect(verbCalls(spy, "chat/share")).toHaveLength(1));
    expect(verbCalls(spy, "chat/share")[0]!.input).toEqual({ id: "c-1", title: "Spec talk" });
    expect(await screen.findByText("Shared")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share this chat" })).toBeNull();
  });

  it("a shared chat shows the Shared badge and no share action", async () => {
    mockFetch(chatRoutes(true));
    renderApp("/chat");
    expect(await screen.findByText("Shared")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share this chat" })).toBeNull();
  });
});

describe("run attach", () => {
  it("picks a ticket and posts run attach with the run id", async () => {
    const spy = mockFetch(() => undefined);
    renderApp("/agents/runs/r-0002");
    fireEvent.click(await screen.findByRole("button", { name: /Attach to ticket/ }));
    const form = screen.getByRole("form", { name: "Attach to ticket" });
    expect(form).toHaveTextContent(/committed to git/);
    const select = within(form).getByLabelText("Ticket") as HTMLSelectElement;
    expect(select.value).toBe("T-001-sa");
    await within(form).findByRole("option", { name: /T-002-sa · Export orders to CSV/ });
    fireEvent.change(select, { target: { value: "T-002-sa" } });
    fireEvent.click(within(form).getByRole("button", { name: "Attach" }));
    await waitFor(() => expect(verbCalls(spy, "run/attach")).toHaveLength(1));
    expect(verbCalls(spy, "run/attach")[0]!.input).toEqual({ run: "r-0002", ticket: "T-002-sa" });
    expect(await screen.findByText(/Attached to/)).toBeInTheDocument();
  });
});

// ---------- people ----------

describe("people page", () => {
  const peopleRoutes =
    (p: PeopleView): Handler =>
    (u) =>
      u.pathname === "/api/v1/people" ? ok(p) : undefined;

  it("shows who you are, the roster and unclaimed git names; claims one", async () => {
    const spy = mockFetch(peopleRoutes(people));
    renderApp("/people");
    expect(await screen.findByText("You are Sam Ali")).toBeInTheDocument();
    const roster = screen.getByRole("table", { name: "Roster" });
    expect(within(roster).getByText("sam@example.com")).toBeInTheDocument();
    expect(within(roster).getByText("none claimed")).toBeInTheDocument();

    const unclaimed = screen.getByRole("list", { name: "Unclaimed git names" });
    expect(within(unclaimed).getByText("Noble Wave")).toBeInTheDocument();
    const claim = within(unclaimed).getByRole("button", { name: "Claim" });
    expect(claim).toBeDisabled();
    fireEvent.change(within(unclaimed).getByRole("combobox", { name: "This is…: Noble Wave" }), { target: { value: "rina" } });
    fireEvent.click(claim);
    await waitFor(() => expect(verbCalls(spy, "people/claim")).toHaveLength(1));
    expect(verbCalls(spy, "people/claim")[0]!.input).toEqual({ id: "rina", git: "noble@example.com" });
  });

  it("adds a person with id and initials suggested from the name", async () => {
    const spy = mockFetch(peopleRoutes(people));
    renderApp("/people");
    const form = await screen.findByRole("form", { name: "Add person" });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: "Zoë de Wit" } });
    expect(within(form).getByLabelText(/^Id/)).toHaveValue("zoe-de-wit");
    expect(within(form).getByLabelText(/^Initials/)).toHaveValue("ZW");
    fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "designer" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(verbCalls(spy, "people/add")).toHaveLength(1));
    expect(verbCalls(spy, "people/add")[0]!.input).toEqual({ id: "zoe-de-wit", name: "Zoë de Wit", initials: "ZW", role: "designer" });
  });

  it("explains how to fix author.local when me is null", async () => {
    mockFetch(peopleRoutes({ ...people, me: null }));
    renderApp("/people");
    expect(await screen.findByText("You are not set on this machine")).toBeInTheDocument();
    expect(screen.getAllByText("author.local").length).toBeGreaterThan(0);
  });

  it("is in the nav", async () => {
    mockFetch(peopleRoutes(people));
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "People" })).toHaveAttribute("href", "/people");
  });

  it("suggests slugs and initials", () => {
    expect(slugify("  Ana María López ")).toBe("ana-maria-lopez");
    expect(initialsOf("Ana María López")).toBe("AL");
    expect(initialsOf("Cher")).toBe("C");
  });
});

// ---------- overrides ----------
