// Milestone 7: project switcher (knowledge center in the top bar, projects in the sidebar, active project filters and
// defaults) and Add project (dry run, then confirm), against the contract with fetch mocked.
import type { Board, CentersView, ProjectsView, SetupStatus, TodoList } from "@helmlock/core/contracts";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, Providers } from "@/App";
import * as fx from "@/test/fixtures";
import { route } from "@/test/server";
import { folderOf } from "./projects/AddProject";
import { inProject } from "./projects/active";

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

type Handler = (url: URL, init?: RequestInit) => Response | undefined;
function mockFetch(handler: Handler = () => undefined) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    return handler(u, init) ?? base(u) ?? route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const posts = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input) === `/api/v1${path}`)
    .map(([, init]) => JSON.parse(String(init!.body)) as { input: Record<string, unknown>; dry_run?: boolean } & Record<string, unknown>);

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// ---------- data ----------

const board: Board = {
  ...fx.board,
  tickets: [{ ...fx.cards[0]!, project: "wms" }, { ...fx.cards[1]!, project: "web" }, { ...fx.cards[2]! }],
};
const projects: ProjectsView = {
  projects: [
    { id: "web", name: "Shop web", status: "active", repos: [{ folder: "shop-web", path: "D:/code/shop-web", exists: true }], tickets: 1 },
    { id: "wms", name: "Warehouse", status: "active", repos: [{ folder: "wms-api", path: "D:/code/wms-api", exists: true }], tickets: 1 },
  ],
};
const T1 = fx.cards[0]!.title; // wms
const T2 = fx.cards[1]!.title; // web
const T3 = fx.cards[2]!.title; // no project

function base(u: URL): Response | undefined {
  const p = u.pathname.replace(/^\/api\/v1/, "");
  if (p === "/board") return ok(board);
  if (p === "/projects") return ok(projects);
  return undefined;
}

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{`${l.pathname}${l.search}`}</output>;
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
const loc = () => screen.getByTestId("location").textContent ?? "";
const sidebar = () => screen.getByRole("navigation", { name: "Main" });

// ---------- tests ----------

describe("pure helpers", () => {
  it("inProject hides items of other projects' tickets and keeps unlinked ones", () => {
    const items = [{ t: fx.cards[0]!.id }, { t: fx.cards[1]!.id }, { t: undefined }, { t: "T-999-xx" }];
    expect(inProject(items, "wms", (i) => i.t, board.tickets)).toEqual([{ t: fx.cards[0]!.id }, { t: undefined }, { t: "T-999-xx" }]);
    expect(inProject(items, "", (i) => i.t, board.tickets)).toHaveLength(4);
  });
  it("folderOf takes the last path segment", () => {
    expect(folderOf("D:\\code\\wms-api\\")).toBe("wms-api");
    expect(folderOf(' "../shop web" ')).toBe("shop web");
  });
});

describe("project switcher", () => {
  it("the sidebar lists projects; picking one filters the board, persists in the URL and storage, the chip clears it", async () => {
    mockFetch();
    renderAt("/tickets");
    expect(await screen.findByText(T2)).toBeInTheDocument();
    const nav = sidebar();
    fireEvent.click(await within(nav).findByRole("button", { name: /Warehouse/ }));
    await waitFor(() => expect(loc()).toContain("project=wms"));
    expect(localStorage.getItem("hl.project")).toBe("wms");
    await waitFor(() => expect(screen.queryByText(T2)).not.toBeInTheDocument());
    expect(screen.getByText(T1)).toBeInTheDocument();
    expect(screen.queryByText(T3)).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Warehouse/ })).toHaveAttribute("aria-pressed", "true");
    // The chip in the top bar names it and clears it.
    const chip = screen.getByTestId("project-chip");
    expect(chip).toHaveTextContent("Warehouse");
    fireEvent.click(within(chip).getByRole("button", { name: "Show all projects" }));
    await waitFor(() => expect(loc()).not.toContain("project="));
    expect(localStorage.getItem("hl.project")).toBe("");
    expect(await screen.findByText(T2)).toBeInTheDocument();
  });

  it("a remembered project comes back into the URL on another page; a link with ?project= wins and is remembered", async () => {
    mockFetch();
    localStorage.setItem("hl.project", "web");
    const first = renderAt("/todos");
    await waitFor(() => expect(loc()).toBe("/todos?project=web"));
    first.unmount();
    renderAt("/tickets?project=wms");
    expect(await screen.findByText(T1)).toBeInTheDocument();
    expect(screen.queryByText(T2)).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("hl.project")).toBe("wms"));
  });

  it("todos of another project's ticket are hidden; todos with no ticket stay", async () => {
    const todos: TodoList = [
      {
        id: "TD-001-sa",
        text: "Ask about pallets",
        status: "open",
        priority: "normal",
        ticket: fx.cards[0]!.id,
        created: "2026-10-01",
        author: "sam",
        scope: "team",
      },
      {
        id: "TD-002-sa",
        text: "Fix the header",
        status: "open",
        priority: "normal",
        ticket: fx.cards[1]!.id,
        created: "2026-10-01",
        author: "sam",
        scope: "team",
      },
      { id: "TD-003-sa", text: "Water the plants", status: "open", priority: "normal", created: "2026-10-01", author: "sam", scope: "team" },
    ];
    mockFetch((u) => (u.pathname === "/api/v1/todos" ? ok(todos) : undefined));
    renderAt("/todos?project=wms");
    expect(await screen.findByText("Ask about pallets")).toBeInTheDocument();
    expect(await screen.findByText("Water the plants")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Fix the header")).not.toBeInTheDocument());
    expect(screen.getByTestId("todos-project-note")).toHaveTextContent("wms");
  });

  it("the knowledge center menu lists the other centers: a running one links, a stopped one shows the command", async () => {
    const centers: CentersView = {
      current: { name: "Test", console_name: "Test Console", root: fx.workspace.root },
      others: [
        {
          name: "Shop",
          root: "D:/kc/shop-knowledge",
          port: 4400,
          last_opened: "2026-10-07T10:00:00Z",
          running: true,
          url: "http://127.0.0.1:4400/",
          command: "hl serve --port 4400",
        },
        { name: "Ops", root: "D:/kc/ops-knowledge", port: 4317, last_opened: "2026-10-01T10:00:00Z", running: false, command: "hl serve" },
      ],
    };
    const spy = mockFetch((u) => (u.pathname === "/api/v1/centers" ? ok(centers) : undefined));
    renderAt("/");
    const trigger = await screen.findByRole("button", { name: /Knowledge center: Test\./ });
    expect(trigger).toHaveAttribute("title", `Knowledge center: ${fx.workspace.root}`);
    expect(spy.mock.calls.some(([i]) => String(i).startsWith("/api/v1/centers"))).toBe(false); // only on open
    fireEvent.click(trigger);
    const list = await screen.findByRole("list", { name: "Other knowledge centers" });
    expect(within(list).getByRole("link", { name: /running at http:\/\/127.0.0.1:4400/ })).toHaveAttribute("href", "http://127.0.0.1:4400/");
    expect(within(list).getByText("Ops")).toBeInTheDocument();
    expect(within(list).getByText("hl serve")).toBeInTheDocument();
  });
});

describe("add project", () => {
  const dryText = '~ Test.code-workspace\n+   { "name": "wms-api", "path": "../wms-api" }\n+ projects/wms-api/project.toml';

  it("one folder: preview (dry run) shows what will change, then Add project confirms with yes", async () => {
    const spy = mockFetch((u, init) => {
      if (init?.method !== "POST" || u.pathname !== "/api/v1/verbs/project/add") return undefined;
      const body = JSON.parse(String(init.body)) as { dry_run?: boolean };
      return body.dry_run
        ? json({ ok: true, data: { id: "wms-api", exists: true, dry_run: true }, text: `${dryText}\ndry run: nothing written` })
        : json({ ok: true, data: { id: "wms-api", changed: ["Test.code-workspace"] }, text: "written" });
    });
    renderAt("/tickets");
    fireEvent.click(await within(sidebar()).findByRole("button", { name: "Add project" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Repo folder/), { target: { value: "../wms-api" } });
    const add = within(dialog).getByRole("button", { name: /Add project/ });
    expect(add).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview changes" }));
    expect(await within(dialog).findByText(/projects\/wms-api\/project.toml/)).toBeInTheDocument();
    expect(posts(spy, "/verbs/project/add")).toEqual([{ input: { folder: "wms-api", path: "../wms-api", id: "wms-api" }, dry_run: true }]);
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(posts(spy, "/verbs/project/add")).toHaveLength(2));
    expect(posts(spy, "/verbs/project/add")[1]).toEqual({ input: { folder: "wms-api", path: "../wms-api", id: "wms-api", yes: true } });
    // The new project becomes the active one.
    await waitFor(() => expect(loc()).toContain("project=wms-api"));
  });

  it("one folder: a folder that does not exist cannot be confirmed", async () => {
    mockFetch((u, init) =>
      init?.method === "POST" && u.pathname === "/api/v1/verbs/project/add"
        ? json({ ok: true, data: { id: "ghost", exists: false, dry_run: true }, text: "! D:/ghost does not exist yet" })
        : undefined,
    );
    renderAt("/tickets");
    fireEvent.click(await within(sidebar()).findByRole("button", { name: "Add project" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Repo folder/), { target: { value: "D:/ghost" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/does not exist/);
    expect(within(dialog).getByRole("button", { name: /Add project/ })).toBeDisabled();
  });

  it("import: lists the file's folders with the skipped ones disabled; a changed selection needs a new preview", async () => {
    const candidates = [
      { name: "knowledge", abs: "D:/kc", id: "knowledge", add: false, reason: "this knowledge center" },
      { name: "shop-api", abs: "D:/code/shop-api", id: "shop-api", add: true },
      { name: "shop-web", abs: "D:/code/shop-web", id: "shop-web", add: true },
    ];
    const setup: SetupStatus = { steps: [{ id: "code", label: "Your code", optional: true, done: false, detail: "no projects yet" }] };
    localStorage.setItem("hl.welcome.draft", JSON.stringify({ step: "code" }));
    const spy = mockFetch((u, init) => {
      if (u.pathname === "/api/v1/setup") return ok(setup);
      if (init?.method !== "POST" || u.pathname !== "/api/v1/verbs/project/import") return undefined;
      const body = JSON.parse(String(init.body)) as { input: { folders?: string[]; yes?: boolean }; dry_run?: boolean };
      const folders = body.input.folders ?? ["shop-api", "shop-web"];
      return json({
        ok: true,
        data: { file: "D:/code/Shop.code-workspace", candidates, folders, ...(body.dry_run ? { dry_run: true } : { changed: ["Test.code-workspace"] }) },
        text: folders.map((f) => `+ projects/${f}/project.toml`).join("\n"),
      });
    });
    renderAt("/welcome");
    // The wizard's Code screen embeds the same flow.
    fireEvent.click(await screen.findByRole("button", { name: "Import a .code-workspace" }));
    fireEvent.change(screen.getByLabelText(/\.code-workspace file/), { target: { value: "D:/code/Shop.code-workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Read folders" }));
    const set = await screen.findByRole("group", { name: "Folders to add" });
    const boxes = within(set).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
    expect(within(set).getByText(/skipped: this knowledge center/)).toBeInTheDocument();
    const addBtn = within(set).getByRole("button", { name: /Add 2 projects/ });
    expect(addBtn).toBeEnabled();
    fireEvent.click(boxes[2]!); // untick shop-web
    const add1 = within(set).getByRole("button", { name: /Add 1 project$/ });
    expect(add1).toBeDisabled();
    fireEvent.click(within(set).getByRole("button", { name: "Preview changes" }));
    await waitFor(() => expect(within(set).getByRole("button", { name: /Add 1 project$/ })).toBeEnabled());
    fireEvent.click(within(set).getByRole("button", { name: /Add 1 project$/ }));
    await waitFor(() => expect(posts(spy, "/verbs/project/import")).toHaveLength(3));
    const calls = posts(spy, "/verbs/project/import");
    expect(calls[0]).toEqual({ input: { file: "D:/code/Shop.code-workspace" }, dry_run: true });
    expect(calls[1]).toEqual({ input: { file: "D:/code/Shop.code-workspace", folders: ["shop-api"] }, dry_run: true });
    expect(calls[2]).toEqual({ input: { file: "D:/code/Shop.code-workspace", folders: ["shop-api"], yes: true } });
  });
});

describe("setup", () => {
  it("the Code screen comes before the first task and embeds Add project", async () => {
    const setup: SetupStatus = {
      steps: [
        { id: "you", label: "You", done: true, detail: "Sam" },
        { id: "code", label: "Your code", optional: true, done: false, detail: "no projects yet", action: "Add project" },
        { id: "first-task", label: "First task", done: false, detail: "no tickets yet" },
      ],
    };
    localStorage.setItem("hl.welcome.draft", JSON.stringify({ step: "code" }));
    mockFetch((u) => (u.pathname === "/api/v1/setup" ? ok(setup) : undefined));
    renderAt("/setup");
    const region = await screen.findByRole("region", { name: "Step: Code" });
    expect(within(region).getByRole("button", { name: "One repo folder" })).toHaveAttribute("aria-pressed", "true");
    expect(within(region).getByLabelText(/Repo folder/)).toBeInTheDocument();
    const steps = within(screen.getByRole("navigation", { name: "Setup progress" })).getAllByRole("button");
    expect(steps.map((b) => b.textContent?.replace(/\s*\((done|skipped)\)/, ""))).toEqual(["You", "Engines", "Code", "Crew", "Phone", "First task"]);
  });
});
