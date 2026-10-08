// Onboarding v2 (Blueprint 34): the /welcome wizard against the contract with fetch mocked. Auto-skip of You when the
// author is known, "Is this you?" from git, engine tests and one-click provider tiles, the crew preset, the first task
// (ticket, hand-off, ticket page), the resumable draft, the skip rules and the console opening /welcome by itself.
import type { CrewView, ModelProbe, ModelsView, SetupDetect, SetupEngineTest, SetupStatus } from "@helmlock/core/contracts";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, Providers } from "@/App";
import * as fx from "@/test/fixtures";
import { route } from "@/test/server";
import { hasUsableEngine, presetCrew, startStep, titleFrom } from "./welcome/draft";

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
const ok = (data: unknown, status = 200) => json({ ok: true, data }, status);

type Handler = (url: URL, init?: RequestInit) => Response | undefined;
function mockFetch(handler: Handler = () => undefined) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    return handler(u, init) ?? route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const posts = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input).split("?")[0] === `/api/v1${path}`)
    .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname}</output>;
}
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}
const where = () => screen.getByTestId("location").textContent;
const draft = (d: Record<string, unknown>) => localStorage.setItem("hl.welcome.draft", JSON.stringify(d));
const region = (label: string) => screen.findByRole("region", { name: `Step: ${label}` });

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

// ---------- data ----------

const unknownYou: SetupDetect = {
  ...fx.setupDetect,
  you: { git_name: "Ann Lee", git_email: "ann@example.com", suggested_slug: "ann", suggested_initials: "al", author_known: false },
};
const noModels: ModelsView = { providers: [], models: [] };
const withModel: ModelsView = {
  providers: [
    { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_env: "OPENROUTER_API_KEY", preset: "openrouter", compat: {} },
  ],
  models: [
    {
      id: "openrouter/deepseek/deepseek-chat",
      provider: "openrouter",
      label: "deepseek-chat",
      capabilities: { tool_calls: true, vision: false, streaming: true },
    },
  ],
  default: "openrouter/deepseek/deepseek-chat",
};
const ROLES = ["analyst", "planner", "builder", "verifier", "fixer", "deployer"];
const crew: CrewView = {
  roles: ROLES.map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    engine: "claude-code",
    worktree: id === "builder",
    engine_ok: true,
    current: [],
  })),
  engines: [],
  live: 0,
  max_live: 3,
  needs_you: [],
};
const helloOk: SetupEngineTest = {
  engine: "claude-code",
  ok: true,
  at: "2026-10-08T10:00:00Z",
  checks: [
    { code: "cli_found", level: "info", message: "found claude (2.1.0)" },
    { code: "hello_ok", level: "info", message: 'Claude Code answered in 3.2s: "hello"' },
  ],
};
const loginNeeded: SetupEngineTest = {
  engine: "claude-code",
  ok: false,
  at: "2026-10-08T10:00:00Z",
  checks: [
    { code: "cli_found", level: "info", message: "found claude (2.1.0)" },
    { code: "login_required", level: "error", message: "Claude Code is not signed in", hint: "run `claude` in a terminal once and sign in with /login" },
  ],
};

// ---------- pure ----------

describe("welcome draft rules", () => {
  it("starts on Engines when the author is known, and never resumes on You then", () => {
    expect(startStep({}, true)).toBe("engine");
    expect(startStep({}, false)).toBe("you");
    expect(startStep({ step: "you" }, true)).toBe("engine");
    expect(startStep({ step: "crew" }, true)).toBe("crew");
  });

  it("an engine is usable after a passing test or with a configured model", () => {
    expect(hasUsableEngine(fx.setupDetect, {})).toBe(false);
    expect(hasUsableEngine(fx.setupDetect, { "claude-code": true })).toBe(true);
    expect(hasUsableEngine({ ...fx.setupDetect, providers: { ...fx.setupDetect.providers, configured: [{ id: "x", label: "X", models: 1 }] } })).toBe(true);
  });

  it("crew preset: a CLI for the build roles, a model on the loop for analyst and planner", () => {
    const p = presetCrew(crew.roles, fx.setupDetect, { "claude-code": true }, "openrouter/deepseek/deepseek-chat");
    expect(p.builder).toEqual({ engine: "claude-code" });
    expect(p.verifier).toEqual({ engine: "claude-code" });
    expect(p.analyst).toEqual({ engine: "loop", model: "openrouter/deepseek/deepseek-chat" });
    expect(presetCrew(crew.roles, fx.setupDetect, {}, undefined).planner).toEqual({ engine: "claude-code" });
  });

  it("the ticket title is the first sentence, at most 80 characters", () => {
    expect(titleFrom("Fix the login page. It forgets me.")).toBe("Fix the login page");
    expect(titleFrom(`${"word ".repeat(30)}end`).length).toBeLessThanOrEqual(83);
  });
});

// ---------- screens ----------

describe("/welcome", () => {
  it("skips You when the author is known and runs upkeep silently", async () => {
    const spy = mockFetch((u) => (u.pathname === "/api/v1/models" ? ok(noModels) : undefined));
    renderAt("/welcome");
    expect(await region("Engines")).toBeInTheDocument();
    await waitFor(() => expect(posts(spy, "/setup/upkeep")).toHaveLength(1));
    expect(screen.queryByText(/upkeep could not be done/)).not.toBeInTheDocument();
    // Three parts in the progress strip.
    const nav = screen.getByRole("navigation", { name: "Setup progress" });
    for (const g of ["Connect", "Organize", "Start"]) expect(within(nav).getByText(g)).toBeInTheDocument();
  });

  it("Is this you: prefilled from git, saved only on confirm, then Engines", async () => {
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/setup/detect") return ok(unknownYou);
      if (u.pathname === "/api/v1/setup/you" && init?.method === "POST")
        return ok({ person: { id: "ann", name: "Ann Lee", initials: "al" }, created: true, claimed: ["Ann Lee", "ann@example.com"] });
      return undefined;
    });
    renderAt("/welcome");
    const step = await region("You");
    expect(within(step).getByRole("heading", { name: "Is this you?" })).toBeInTheDocument();
    expect(within(step).getByLabelText(/Name/)).toHaveValue("Ann Lee");
    expect(within(step).getByLabelText(/^Id/)).toHaveValue("ann");
    expect(within(step).getByLabelText(/Initials/)).toHaveValue("al");
    expect(posts(spy, "/setup/you")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, this is me" }));
    await waitFor(() => expect(posts(spy, "/setup/you")).toHaveLength(1));
    expect(posts(spy, "/setup/you")[0]).toEqual({ id: "ann", name: "Ann Lee", initials: "al", email: "ann@example.com", git: ["Ann Lee", "ann@example.com"] });
    expect(await region("Engines")).toBeInTheDocument();
  });

  it("Engines: Continue waits for a passing test; Test shows the ordered checks with hints", async () => {
    let reply = loginNeeded;
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/models") return ok(noModels);
      if (u.pathname === "/api/v1/setup/test-engine" && init?.method === "POST") return ok(reply);
      return undefined;
    });
    renderAt("/welcome");
    const step = await region("Engines");
    const cont = within(step).getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    const tile = within(step).getByRole("listitem", { name: "Claude Code" });
    expect(tile).toHaveTextContent("2.1.0 (Claude Code)");
    fireEvent.click(within(tile).getByRole("button", { name: "Test" }));
    const checks = await within(tile).findByRole("list", { name: "Claude Code checks" });
    expect(posts(spy, "/setup/test-engine")[0]).toEqual({ engine: "claude-code" });
    expect(checks).toHaveTextContent("Claude Code is not signed in");
    expect(checks).toHaveTextContent("sign in with /login");
    expect(cont).toBeDisabled();
    reply = helloOk;
    fireEvent.click(within(tile).getByRole("button", { name: "Test again" }));
    await within(tile).findByText(/answered in 3\.2s/);
    await waitFor(() => expect(cont).toBeEnabled());
  });

  it("Engines: a key found in the environment is one click: fetch models, provider add with the key name, default model", async () => {
    let models = noModels;
    const listed: ModelProbe = {
      provider: "draft",
      reachable: true,
      models: ["deepseek/deepseek-chat", "qwen/qwen3-coder"],
      chat: false,
      streaming: false,
      tool_calls: false,
      base_url: "https://openrouter.ai/api/v1",
    };
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/models") return ok(models);
      if (u.pathname === "/api/v1/models/try" && init?.method === "POST") return ok(listed);
      if (u.pathname === "/api/v1/verbs/provider/add" && init?.method === "POST") {
        models = withModel;
        return json({ ok: true, data: { provider: "openrouter", models: ["openrouter/deepseek/deepseek-chat"] } });
      }
      if (u.pathname.startsWith("/api/v1/verbs/") && init?.method === "POST") return json({ ok: true, data: {} });
      return undefined;
    });
    renderAt("/welcome");
    const step = await region("Engines");
    const tile = within(step).getByRole("listitem", { name: "OpenRouter" });
    expect(tile).toHaveTextContent("key found in the environment (OPENROUTER_API_KEY)");
    fireEvent.click(within(tile).getByRole("button", { name: "Add OpenRouter" }));
    await waitFor(() => expect(posts(spy, "/verbs/model/default")).toHaveLength(1));
    expect(posts(spy, "/models/try")[0]).toEqual({
      base_url: "https://openrouter.ai/api/v1",
      preset: "openrouter",
      key_env: "OPENROUTER_API_KEY",
      list_only: true,
    });
    expect(posts(spy, "/verbs/provider/add")[0]).toEqual({
      input: {
        id: "openrouter",
        preset: "openrouter",
        base_url: "https://openrouter.ai/api/v1",
        key_env: "OPENROUTER_API_KEY",
        models: ["deepseek/deepseek-chat"],
      },
    });
    expect(posts(spy, "/verbs/model/default")[0]).toEqual({ input: { id: "openrouter/deepseek/deepseek-chat" } });
    expect(await within(tile).findByText("added")).toBeInTheDocument();
    // Another default: model add, then model default.
    fireEvent.change(within(tile).getByLabelText("Default model"), { target: { value: "qwen/qwen3-coder" } });
    await waitFor(() => expect(posts(spy, "/verbs/model/default")).toHaveLength(2));
    expect(posts(spy, "/verbs/model/add")[0]).toEqual({ input: { provider: "openrouter", models: ["qwen/qwen3-coder"] } });
    await waitFor(() => expect(within(step).getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("Engines: Other provider opens the provider form", async () => {
    mockFetch((u) => (u.pathname === "/api/v1/models" ? ok(noModels) : undefined));
    renderAt("/welcome");
    fireEvent.click(await screen.findByRole("button", { name: "Other provider" }));
    const dialog = await screen.findByRole("dialog", { name: "Other provider" });
    expect(within(dialog).getByTestId("provider-form")).toBeInTheDocument();
  });

  it("Crew: preset from what passed, saved with crew set for the changed roles", async () => {
    draft({ step: "crew", tests: { "claude-code": true } });
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/models") return ok(withModel);
      if (u.pathname === "/api/v1/crew") return ok(crew);
      if (u.pathname.startsWith("/api/v1/verbs/") && init?.method === "POST") return json({ ok: true, data: {} });
      return undefined;
    });
    renderAt("/welcome");
    const step = await region("Crew");
    await waitFor(() => expect(within(step).getByLabelText("Analyst engine")).toHaveValue("loop"));
    expect(within(step).getByLabelText("Analyst model")).toHaveValue("openrouter/deepseek/deepseek-chat");
    expect(within(step).getByLabelText("Builder engine")).toHaveValue("claude-code");
    // The person changes one: the planner stays on the CLI.
    fireEvent.change(within(step).getByLabelText("Planner engine"), { target: { value: "claude-code" } });
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    fireEvent.click(within(step).getByRole("button", { name: "Save crew and continue" }));
    await waitFor(() => expect(posts(spy, "/verbs/crew/set")).toHaveLength(1));
    expect(posts(spy, "/verbs/crew/set")[0]).toEqual({ input: { role: "analyst", engine: "loop", model: "openrouter/deepseek/deepseek-chat" } });
    expect(await region("Phone")).toBeInTheDocument();
  });

  it("only Code and Phone can be skipped; a skipped step shows in the strip", async () => {
    draft({ step: "code" });
    mockFetch();
    renderAt("/welcome");
    await region("Code");
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await region("Crew");
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Setup progress" });
    expect(within(nav).getByRole("button", { name: /Code \(skipped\)/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" })); // no crew here: Continue moves on
    await region("Phone");
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await region("Crew")).toBeInTheDocument();
  });

  it("First task: creates the ticket, hands it to the next role and opens the ticket thread", async () => {
    draft({ step: "first-task" });
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/verbs/ticket/new" && init?.method === "POST")
        return json({ ok: true, data: { id: "T-009-sa", ticket: {} }, text: "T-009-sa  backlog  Add dark mode" });
      if (u.pathname === "/api/v1/tickets/T-009-sa/handoff" && init?.method === "POST")
        return ok({ id: "r-1", runtime: "claude-code", mode: "ask", status: "running", started: "2026-10-08T10:00:00Z", ticket: "T-009-sa" }, 201);
      return undefined;
    });
    renderAt("/welcome");
    const step = await region("First task");
    const start = within(step).getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    fireEvent.change(within(step).getByLabelText(/The task/), { target: { value: "Add dark mode to settings. Users keep asking." } });
    expect(within(step).getByLabelText("Project")).toHaveValue("wms");
    fireEvent.click(start);
    await waitFor(() => expect(where()).toBe("/t/T-009-sa"));
    expect(posts(spy, "/verbs/ticket/new")[0]).toEqual({
      input: { title: "Add dark mode to settings", summary: "Add dark mode to settings. Users keep asking.", project: "wms" },
    });
    expect(posts(spy, "/tickets/T-009-sa/handoff")[0]).toEqual({});
    expect(localStorage.getItem("hl.welcome.draft")).toBeNull();
  });

  it("the draft survives a reload: same screen, same text", async () => {
    draft({ step: "first-task" });
    mockFetch();
    const first = renderAt("/welcome");
    const step = await region("First task");
    fireEvent.change(within(step).getByLabelText(/The task/), { target: { value: "Write the release notes" } });
    first.unmount();
    renderAt("/welcome");
    const again = await region("First task");
    expect(within(again).getByLabelText(/The task/)).toHaveValue("Write the release notes");
  });

  it("works when storage throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    mockFetch((u) => (u.pathname === "/api/v1/models" ? ok(noModels) : undefined));
    renderAt("/welcome");
    expect(await region("Engines")).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("opening /welcome by itself", () => {
  const status = (youDone: boolean): SetupStatus => ({
    steps: [
      { id: "you", label: "You", done: youDone, detail: "" },
      { id: "engine", label: "Engines", done: true, detail: "Claude Code" },
      { id: "first-task", label: "First task", done: false, detail: "" },
    ],
  });

  it("once per session when there is no author", async () => {
    mockFetch((u) => (u.pathname === "/api/v1/setup" ? ok(status(false)) : u.pathname === "/api/v1/setup/detect" ? ok(unknownYou) : undefined));
    const first = renderAt("/");
    await waitFor(() => expect(where()).toBe("/welcome"));
    first.unmount();
    renderAt("/");
    await screen.findByRole("region", { name: "Finish setup" });
    expect(where()).toBe("/");
  });

  it("not when the author and an engine are there", async () => {
    mockFetch((u) => (u.pathname === "/api/v1/setup" ? ok(status(true)) : undefined));
    renderAt("/");
    await screen.findByRole("region", { name: "Finish setup" });
    expect(where()).toBe("/");
  });
});
