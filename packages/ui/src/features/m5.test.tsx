// Milestone 5 stream B2: inbox state, knowledge and the setup wizard against the contract, with fetch mocked.
import type { ApprovalCard, InboxItem, KnowledgeView, ModelProbe, SettingsView, SetupStatus } from "@helmlock/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";
import { resurfaced, selectItems } from "./inbox/inbox-state";
import { filterIndex } from "./knowledge/KnowledgePage";
import { startIndex } from "./setup/SetupPage";

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
const posts = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input).split("?")[0] === `/api/v1${path}`)
    .map(([, init]) => ({ body: JSON.parse(String(init!.body)) as Record<string, unknown>, headers: init!.headers as Record<string, string> }));

afterEach(() => vi.unstubAllGlobals());

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

// ---------- inbox ----------

const items: InboxItem[] = [
  {
    key: "q:T-001-sa:Q-1",
    kind: "question",
    title: "Which gift card provider?",
    ticket: "T-001-sa",
    id: "Q-1",
    updated: iso(NOW - 60_000),
    read: false,
    archived: false,
  },
  { key: "b:T-002-sa", kind: "blocked", title: "T-002-sa waiting on Q-3", ticket: "T-002-sa", updated: iso(NOW - 3_600_000), read: true, archived: false },
  { key: "r:r-9", kind: "run-failed", title: "builder run failed", id: "r-9", updated: iso(NOW - 86_400_000), read: true, archived: true },
];

function inboxServer(list: InboxItem[], extra?: Handler) {
  return mockFetch((u, init) => {
    const r = extra?.(u, init);
    if (r) return r;
    if (u.pathname === "/api/v1/inbox") return ok(list);
    const m = /^\/api\/v1\/inbox\/(.+)$/.exec(u.pathname);
    if (m && init?.method === "POST") {
      const key = decodeURIComponent(m[1]!);
      const body = JSON.parse(String(init.body)) as { read?: boolean; archived?: boolean };
      const it = list.find((i) => i.key === key)!;
      return ok({ ...it, ...body });
    }
    return undefined;
  });
}

describe("inbox", () => {
  it("selects views and kinds, newest first", () => {
    expect(selectItems(items, "unread", new Set()).map((i) => i.key)).toEqual(["q:T-001-sa:Q-1"]);
    expect(selectItems(items, "all", new Set()).map((i) => i.key)).toEqual(["q:T-001-sa:Q-1", "b:T-002-sa"]);
    expect(selectItems(items, "all", new Set(["blocked"])).map((i) => i.key)).toEqual(["b:T-002-sa"]);
    expect(selectItems(items, "archived", new Set()).map((i) => i.key)).toEqual(["r:r-9"]);
  });

  it("shows Unread, All and Archived views and filters by kind", async () => {
    inboxServer(items);
    renderApp("/inbox");
    const list = await screen.findByRole("list", { name: "Inbox items" });
    expect(
      within(list)
        .getAllByRole("listitem", { name: /./ })
        .map((li) => li.getAttribute("data-inbox-key")),
    ).toEqual(["q:T-001-sa:Q-1"]);

    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Inbox items" }).querySelectorAll("[data-inbox-key]")).toHaveLength(2));
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by kind" })).getByRole("button", { name: "Blocked" }));
    await waitFor(() =>
      expect([...screen.getByRole("list", { name: "Inbox items" }).querySelectorAll("[data-inbox-key]")].map((e) => e.getAttribute("data-inbox-key"))).toEqual([
        "b:T-002-sa",
      ]),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Archived/ }));
    expect(await screen.findByText("builder run failed")).toBeInTheDocument();
    expect(screen.queryByText("Which gift card provider?")).not.toBeInTheDocument();
  });

  it("e archives and u toggles read on the selected item, with the write header", async () => {
    const spy = inboxServer(items);
    renderApp("/inbox?view=all");
    await screen.findByRole("list", { name: "Inbox items" });
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "u" });
    await waitFor(() => expect(posts(spy, "/inbox/q%3AT-001-sa%3AQ-1")).toHaveLength(1));
    const read = posts(spy, "/inbox/q%3AT-001-sa%3AQ-1")[0]!;
    expect(read.body).toEqual({ read: true });
    expect(read.headers["X-Helmlock-Request"]).toBe("1");
    expect(read.headers["Content-Type"]).toBe("application/json");

    fireEvent.keyDown(document.body, { key: "e" });
    await waitFor(() => expect(posts(spy, "/inbox/q%3AT-001-sa%3AQ-1")).toHaveLength(2));
    expect(posts(spy, "/inbox/q%3AT-001-sa%3AQ-1")[1]!.body).toEqual({ archived: true });
  });

  it("the archive button posts archived and Enter opens the ticket and marks it read", async () => {
    const spy = inboxServer(items);
    renderApp("/inbox?view=all");
    await screen.findByRole("list", { name: "Inbox items" });
    fireEvent.click(screen.getByRole("button", { name: "Archive: T-002-sa waiting on Q-3" }));
    await waitFor(() => expect(posts(spy, "/inbox/b%3AT-002-sa")[0]?.body).toEqual({ archived: true }));

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(posts(spy, "/inbox/q%3AT-001-sa%3AQ-1")[0]?.body).toEqual({ read: true }));
    expect(await screen.findByRole("heading", { level: 1, name: /Gift card redemption at checkout/ })).toBeInTheDocument();
  });

  it("an archived item that came back with new activity shows a chip", async () => {
    localStorage.setItem("hl.inbox.archived", JSON.stringify({ "b:T-005-sa": iso(NOW - 5 * 86_400_000) }));
    const back: InboxItem = {
      key: "b:T-005-sa",
      kind: "blocked",
      title: "Opening hours blocked again",
      ticket: "T-005-sa",
      updated: iso(NOW - 120_000),
      read: false,
      archived: false,
    };
    expect(resurfaced(back, { "b:T-005-sa": "earlier" })).toBe(true);
    expect(resurfaced(back, {})).toBe(false);
    inboxServer([back, items[0]!]);
    renderApp("/inbox");
    const row = await screen.findByRole("listitem", { name: "Opening hours blocked again" });
    expect(within(row).getByTestId("new-activity")).toHaveTextContent("new activity");
    expect(within(screen.getByRole("listitem", { name: "Which gift card provider?" })).queryByTestId("new-activity")).toBeNull();
  });

  it("renders approval items with the approval card inline and shows the unread count in the nav", async () => {
    const card: ApprovalCard = {
      id: "a-7",
      action: "Run a shell command",
      detail: "git push",
      tool: "Bash",
      actor: { kind: "agent", id: "builder", onBehalfOf: "sam" },
      run_id: "r-0100",
      local_only: false,
      created: iso(NOW - 10_000),
      expires: iso(NOW + 240_000),
      status: "pending",
    };
    const approval: InboxItem = {
      key: "approval:a-7",
      kind: "approval",
      title: "Approve: git push",
      id: "a-7",
      updated: iso(NOW - 10_000),
      read: false,
      archived: false,
    };
    inboxServer([approval, items[0]!], (u) => (u.pathname === "/api/v1/approvals" ? ok([card]) : undefined));
    renderApp("/inbox");
    expect(await screen.findByRole("region", { name: "Approval a-7" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: /Inbox/ })).toHaveTextContent("2"));
  });

  it("falls back to the needs-you view when the server has no inbox route", async () => {
    renderApp("/inbox");
    expect(await screen.findByRole("list", { name: "Needs you" })).toBeInTheDocument();
  });
});

// ---------- knowledge ----------

const knowledge: KnowledgeView = {
  index: [
    { path: "shared/wiki/glossary.md", title: "Glossary", summary: "Words we use", kind: "glossary" },
    { path: "shared/runbooks/release.md", title: "Release runbook", summary: "How we ship a release", kind: "runbook" },
    { path: "shared/standards/naming.md", title: "Naming standard", summary: "Folder and file names", kind: "standard" },
  ],
  projects: [
    { id: "wms", name: "Warehouse API", status: "active", owners: ["sam"], repos: ["wms-api"], goals: ["Ship v2 picking"], tickets: 3 },
    { id: "shop", name: "Shop front", status: "paused", owners: ["lee", "sam"], repos: [], goals: [], tickets: 1 },
  ],
  digests: [
    { ticket: "T-010-sa", title: "Older digest", closed: "2026-09-01", path: "artifacts/T-010-sa/digest.md" },
    { ticket: "T-012-sa", title: "Newer digest", closed: "2026-10-01", path: "artifacts/T-012-sa/digest.md" },
  ],
};

function knowledgeServer(view: KnowledgeView = knowledge) {
  return mockFetch((u) => {
    if (u.pathname === "/api/v1/knowledge") return ok(view);
    if (u.pathname === "/api/v1/knowledge/doc") {
      const path = u.searchParams.get("path")!;
      return ok({ path, text: `# Doc ${path}\n\nRelease **steps**.\n\n<script>alert(1)</script>` });
    }
    return undefined;
  });
}

describe("knowledge", () => {
  it("filters the index by text", () => {
    expect(filterIndex(knowledge.index, "ship", "").map((d) => d.title)).toEqual(["Release runbook"]);
    expect(filterIndex(knowledge.index, "", "glossary").map((d) => d.title)).toEqual(["Glossary"]);
    expect(filterIndex(knowledge.index, "names", "").map((d) => d.title)).toEqual(["Naming standard"]);
  });

  it("filters the index and opens a document through /knowledge/doc as sanitised markdown", async () => {
    const spy = knowledgeServer();
    renderApp("/knowledge");
    const list = await screen.findByRole("list", { name: "Shared documents" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Filter documents"), { target: { value: "release" } });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Shared documents" })).getAllByRole("listitem")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Release runbook/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Doc shared/runbooks/release.md" })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(spy.mock.calls.some(([input]) => String(input) === `/api/v1/knowledge/doc?path=${encodeURIComponent("shared/runbooks/release.md")}`)).toBe(true);
  });

  it("shows project cards linking to the board filtered by project, and digests newest first", async () => {
    knowledgeServer();
    renderApp("/knowledge?tab=projects");
    const card = await screen.findByLabelText("Project Warehouse API");
    expect(within(card).getByText("active")).toBeInTheDocument();
    expect(within(card).getByText("wms-api")).toBeInTheDocument();
    expect(within(card).getByText("Ship v2 picking")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "3 tickets of Warehouse API on the board" })).toHaveAttribute("href", "/tickets?project=wms");
    fireEvent.click(within(card).getByRole("link", { name: /tickets of Warehouse API/ }));
    expect(await screen.findByRole("button", { name: "Project: wms ×" })).toBeInTheDocument();
  });

  it("lists digests newest first", async () => {
    knowledgeServer();
    renderApp("/knowledge?tab=digests");
    const list = await screen.findByRole("list", { name: "Closure digests" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("Newer digest"), expect.stringContaining("Older digest")]);
  });

  it("explains how to build the index when it is empty", async () => {
    knowledgeServer({ index: [], projects: [], digests: [] });
    renderApp("/knowledge");
    expect(await screen.findByText("The shared index is empty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy: hl index build" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy: hl notes build" })).toBeInTheDocument();
  });
});

// ---------- setup ----------

const setup: SetupStatus = {
  steps: [
    { id: "author", label: "Author", done: true, detail: "You are sam." },
    { id: "model", label: "Model", done: false, detail: "No provider configured." },
    { id: "telegram", label: "Telegram", done: false, detail: "Optional." },
    { id: "first-ticket", label: "First ticket", done: true, detail: "T-001-sa exists." },
    { id: "agents", label: "Agents", done: false, detail: "Agents not synced.", action: "hl harness sync" },
    { id: "trust", label: "Trust", done: false, detail: "Claude Code has not trusted this folder." },
  ],
};
const probe: ModelProbe = { provider: "ollama", reachable: true, models: ["qwen3:14b"], chat: true, streaming: true, tool_calls: true };

function setupServer(extra?: Handler) {
  return mockFetch((u, init) => {
    const r = extra?.(u, init);
    if (r) return r;
    if (u.pathname === "/api/v1/setup") return ok(setup);
    if (u.pathname === "/api/v1/models") return ok({ providers: [], models: [] });
    if (u.pathname === "/api/v1/models/test" && init?.method === "POST") return ok(probe);
    if (u.pathname.startsWith("/api/v1/verbs/") && init?.method === "POST") return json({ ok: true, data: { changed: true } });
    if (u.pathname === "/api/v1/settings") return ok({ sections: [] } satisfies SettingsView);
    return undefined;
  });
}

describe("setup wizard", () => {
  it("starts at the first open step", () => {
    expect(startIndex(setup.steps, undefined)).toBe(1);
    expect(startIndex(setup.steps, "trust")).toBe(5);
  });

  it("shows progress and moves with Continue and Back", async () => {
    setupServer();
    renderApp("/setup");
    expect(await screen.findByText("2 of 6 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("region", { name: "Step: Model" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("region", { name: "Step: Telegram" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Step: Model" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Agents/ }));
    expect(screen.getByRole("button", { name: "Copy: hl harness sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and exit" })).toBeInTheDocument();
  });

  const LAN = "http://192.168.1.14:1234";
  const listed: ModelProbe = {
    provider: "draft",
    reachable: true,
    models: ["spark-x2.5-4b", "google/gemma-4-12b-qat", "text-embedding-nomic"],
    chat: false,
    streaming: false,
    tool_calls: false,
    base_url: `${LAN}/v1`,
    model_info: [
      { id: "spark-x2.5-4b", label: "Spark X2.5 4B", context_window: 1048576, tool_calls: true, vision: false, loaded: false },
      { id: "google/gemma-4-12b-qat", label: "Gemma 4 12B QAT", context_window: 262144, tool_calls: true, vision: true, loaded: true },
    ],
  };
  const tested: ModelProbe = { ...listed, chat: true, streaming: true, tool_calls: true, model: "spark-x2.5-4b" };
  const tryServer = (fetchReply: () => Response = () => ok(listed)) =>
    setupServer((u, init) => {
      if (u.pathname !== "/api/v1/models/try" || init?.method !== "POST") return undefined;
      return JSON.parse(String(init.body)).list_only ? fetchReply() : ok(tested);
    });

  it("the model step tries a provider before saving: fetch, pick, test, save", async () => {
    const spy = tryServer();
    renderApp("/setup");
    const step = await screen.findByRole("region", { name: "Step: Model" });
    // LM Studio is the default preset; the base URL is editable (another machine on the LAN).
    expect(within(step).getByLabelText(/Base URL/)).toHaveValue("http://127.0.0.1:1234/v1");
    const save = within(step).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(within(step).getByLabelText(/Base URL/), { target: { value: LAN } });
    fireEvent.click(within(step).getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(posts(spy, "/models/try")).toHaveLength(1));
    const fetchCall = posts(spy, "/models/try")[0]!;
    expect(fetchCall.body).toEqual({ base_url: LAN, preset: "lmstudio", list_only: true });
    expect(fetchCall.headers["X-Helmlock-Request"]).toBe("1");

    // The checklist lists the loaded model first, with its badges, and preticks it.
    const picker = await within(step).findByRole("group", { name: "Models on the server" });
    const boxes = within(picker).getAllByRole("checkbox");
    expect(boxes.map((r) => (r as HTMLInputElement).value)).toEqual(["google/gemma-4-12b-qat", "spark-x2.5-4b"]);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(picker).toHaveTextContent("loaded");
    expect(picker).toHaveTextContent("256k ctx");
    expect(picker).toHaveTextContent("1M ctx");
    expect(picker).toHaveTextContent("vision");
    expect(save).toBeEnabled();
    expect(posts(spy, "/verbs/provider/add")).toHaveLength(0);

    // Test connection tries the first ticked model.
    fireEvent.click(within(picker).getByRole("checkbox", { name: /gemma/ }));
    fireEvent.click(within(picker).getByRole("checkbox", { name: /spark-x2\.5-4b/ }));
    fireEvent.click(within(step).getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(posts(spy, "/models/try")).toHaveLength(2));
    expect(posts(spy, "/models/try")[1]!.body).toEqual({ base_url: LAN, preset: "lmstudio", model: "spark-x2.5-4b" });
    const result = await within(step).findByTestId("probe-result");
    expect(result).toHaveTextContent("chat yes");
    expect(result).toHaveTextContent("tool calls yes");
    expect(result).toHaveTextContent("tested spark-x2.5-4b");

    // Several models: Save writes every ticked one with what the probe found.
    fireEvent.click(within(picker).getByRole("checkbox", { name: /gemma/ }));
    const saveMany = within(step).getByRole("button", { name: "Save 2 models" });
    fireEvent.click(saveMany);
    await waitFor(() => expect(posts(spy, "/verbs/provider/add")).toHaveLength(1));
    expect(posts(spy, "/verbs/secret/set")).toHaveLength(0);
    expect(posts(spy, "/verbs/provider/add")[0]!.body).toEqual({
      input: {
        id: "lmstudio",
        preset: "lmstudio",
        base_url: `${LAN}/v1`,
        models: ["spark-x2.5-4b", "google/gemma-4-12b-qat"],
        model_info: [
          { id: "spark-x2.5-4b", context_window: 1048576, tool_calls: true, vision: false },
          { id: "google/gemma-4-12b-qat", context_window: 262144, tool_calls: true, vision: true },
        ],
      },
    });
    expect(await within(step).findByText(/Provider saved/)).toHaveTextContent("lmstudio/spark-x2.5-4b, lmstudio/google/gemma-4-12b-qat");
  });

  it("a failed fetch shows the code, the message and a hint, and Save stays off", async () => {
    tryServer(() =>
      ok({ ...listed, reachable: false, models: [], model_info: undefined, error: { code: "network", message: "cannot reach http://192.168.1.14:1234/v1" } }),
    );
    renderApp("/setup");
    const step = await screen.findByRole("region", { name: "Step: Model" });
    fireEvent.click(within(step).getByRole("button", { name: "Fetch models" }));
    const out = await within(step).findByTestId("fetch-result");
    expect(out).toHaveTextContent("network");
    expect(out).toHaveTextContent("cannot reach");
    expect(out).toHaveTextContent(/allows LAN access/);
    expect(within(step).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Settings > Models offers the same try-before-save form under Add provider", async () => {
    const spy = tryServer();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).split("?")[0] === "/api/v1/settings"
        ? ok({ sections: [{ id: "models", label: "Models", plugins: [] }] } satisfies SettingsView)
        : base(input, init),
    );
    renderApp("/settings#settings-models");
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    const form = await screen.findByTestId("provider-form");
    fireEvent.click(within(form).getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(posts(spy, "/models/try")).toHaveLength(1));
    expect(await within(form).findByRole("group", { name: "Models on the server" })).toBeInTheDocument();
  });

  it("a pasted key is used only for the try, then saved with secret set before provider add; it is never shown again", async () => {
    const KEY = "sk-or-v1-abc123secret";
    const spy = tryServer();
    renderApp("/setup");
    const step = await screen.findByRole("region", { name: "Step: Model" });
    fireEvent.click(within(step).getByRole("button", { name: /OpenRouter/ }));
    const keyField = within(step).getByLabelText(/API key/) as HTMLInputElement;
    expect(keyField).toHaveValue("OPENROUTER_API_KEY");
    expect(keyField.type).toBe("text");
    fireEvent.change(keyField, { target: { value: KEY } });
    expect(keyField.type).toBe("password");
    expect(step).toHaveTextContent("The key is saved only on this machine, in .env, which git ignores; workspace.toml gets only the name");

    fireEvent.click(within(step).getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(posts(spy, "/models/try")).toHaveLength(1));
    expect(posts(spy, "/models/try")[0]!.body).toEqual({ base_url: "https://openrouter.ai/api/v1", preset: "openrouter", key: KEY, list_only: true });
    await within(step).findByRole("group", { name: "Models on the server" });

    fireEvent.click(within(step).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(spy, "/verbs/provider/add")).toHaveLength(1));
    const verbCalls = spy.mock.calls.map(([input]) => String(input)).filter((u) => u.includes("/verbs/"));
    expect(verbCalls).toEqual(["/api/v1/verbs/secret/set", "/api/v1/verbs/provider/add"]);
    expect(posts(spy, "/verbs/secret/set")[0]!.body).toEqual({ input: { name: "OPENROUTER_API_KEY", value: KEY } });
    const add = posts(spy, "/verbs/provider/add")[0]!.body.input as Record<string, unknown>;
    expect(add.key_env).toBe("OPENROUTER_API_KEY");
    expect(JSON.stringify(add)).not.toContain(KEY);
    expect(await within(step).findByText(/Provider saved/)).toHaveTextContent("key saved on this machine as OPENROUTER_API_KEY");
    // The field holds the name now; the key is nowhere on the page.
    expect(keyField).toHaveValue("OPENROUTER_API_KEY");
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it("a key for a provider without a preset name is saved as <PROVIDER_ID>_API_KEY; a failed secret set stops the save", async () => {
    const spy = tryServer();
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/v1/verbs/secret/set"
        ? json({ ok: false, code: 1, error: { rule: "secret", message: "cannot write .env", fix: "check the folder" } })
        : base(input, init),
    );
    renderApp("/setup");
    const step = await screen.findByRole("region", { name: "Step: Model" });
    fireEvent.change(within(step).getByLabelText(/Provider id/), { target: { value: "my-lab" } });
    fireEvent.change(within(step).getByLabelText(/API key/), { target: { value: "abc.def-123" } });
    fireEvent.click(within(step).getByRole("button", { name: "Fetch models" }));
    await within(step).findByRole("group", { name: "Models on the server" });
    fireEvent.click(within(step).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(spy, "/verbs/secret/set")).toHaveLength(1));
    expect(posts(spy, "/verbs/secret/set")[0]!.body).toEqual({ input: { name: "MY_LAB_API_KEY", value: "abc.def-123" } });
    expect(await within(step).findByRole("alert")).toHaveTextContent("cannot write .env");
    expect(posts(spy, "/verbs/provider/add")).toHaveLength(0);
  });

  it("the telegram step saves the allowed ids as an array through config set", async () => {
    const spy = setupServer();
    renderApp("/setup");
    await screen.findByRole("region", { name: "Step: Model" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const step = screen.getByRole("region", { name: "Step: Telegram" });
    fireEvent.change(within(step).getByLabelText(/Allowed Telegram user ids/), { target: { value: "123, 456" } });
    fireEvent.click(within(step).getByRole("button", { name: "Save ids" }));
    await waitFor(() => expect(posts(spy, "/verbs/config/set")).toHaveLength(1));
    expect(posts(spy, "/verbs/config/set")[0]!.body).toEqual({ input: { plugin: "telegram", key: "allowed_user_ids", value: ["123", "456"], local: true } });
  });

  it("Overview shows Finish setup with the open step count", async () => {
    setupServer();
    renderApp("/");
    const card = await screen.findByRole("region", { name: "Finish setup" });
    expect(card).toHaveTextContent("Finish setup (4 left)");
    expect(within(card).getByRole("link", { name: "Continue setup" })).toHaveAttribute("href", "/setup");
  });
});

// ---------- settings list type ----------

describe("list setting", () => {
  it("sends a comma-separated list as an array", async () => {
    const view: SettingsView = {
      sections: [
        {
          id: "telegram",
          label: "Telegram",
          plugins: [
            {
              plugin: "telegram",
              label: "Telegram",
              fields: [{ key: "allowed_user_ids", type: "list", label: "Allowed Telegram user ids", scope: "local" }],
              values: { allowed_user_ids: { value: ["111"], source: "workspace.local.toml" } },
            },
          ],
        },
      ],
    };
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/settings") return ok(view);
      if (u.pathname === "/api/v1/verbs/config/set" && init?.method === "POST") return json({ ok: true, data: { changed: true } });
      return undefined;
    });
    renderApp("/settings#settings-telegram");
    const input = await screen.findByLabelText("Allowed Telegram user ids");
    expect(input).toHaveValue("111");
    fireEvent.change(input, { target: { value: "111, 222 , ,333" } });
    fireEvent.blur(input);
    await waitFor(() => expect(posts(spy, "/verbs/config/set")).toHaveLength(1));
    expect(posts(spy, "/verbs/config/set")[0]!.body).toEqual({
      input: { plugin: "telegram", key: "allowed_user_ids", value: ["111", "222", "333"], local: true },
    });
  });
});
