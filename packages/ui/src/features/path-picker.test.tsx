// Folder picker for Add project: browse server-listed folders, select a folder (fills the input and runs the dry run),
// pick a .code-workspace file in workspace mode, recent picks as shortcuts.
import type { FsEntry, FsListing } from "@helmlock/core/contracts";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/App";
import { crumbs, readRecentPicks } from "@/components/PathPicker";
import { AddProject } from "./projects/AddProject";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ROOT = "D:\\code";
const folder = (name: string, extra: Partial<FsEntry> = {}): FsEntry => ({ name, path: `${ROOT}\\${name}`, kind: "folder", ...extra });
function listing(path: string, mode: string): FsListing | undefined {
  const base = { roots: ["C:\\", "D:\\"], truncated: false, shortcuts: [{ label: "Home", path: "C:\\Users\\sam" }] };
  if (path === "" || path === ROOT)
    return {
      ...base,
      path: ROOT,
      parent: "D:\\",
      entries: [
        folder("shop", { git: false, workspace: true }),
        folder("wms-api", { git: true, workspace: false }),
        ...(mode === "workspace" ? [{ name: "Team.code-workspace", path: `${ROOT}\\Team.code-workspace`, kind: "workspace-file" as const }] : []),
      ],
    };
  if (path === `${ROOT}\\wms-api`) return { ...base, path, parent: ROOT, entries: [folder("wms-api\\src")] };
  if (path === `${ROOT}\\shop`)
    return {
      ...base,
      path,
      parent: ROOT,
      entries: mode === "workspace" ? [{ name: "Shop.code-workspace", path: `${path}\\Shop.code-workspace`, kind: "workspace-file" }] : [],
    };
  return undefined;
}

function mockFetch() {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), "http://localhost");
    if (u.pathname === "/api/v1/fs/list") {
      const l = listing(u.searchParams.get("path") ?? "", u.searchParams.get("mode") ?? "folder");
      return l ? json({ ok: true, data: l }) : json({ ok: false, error: { rule: "not-found", message: "D:\\nope does not exist" } }, 404);
    }
    if (init?.method === "POST" && u.pathname === "/api/v1/verbs/project/add")
      return json({ ok: true, data: { id: "wms-api", exists: true, dry_run: true }, text: "+ projects/wms-api/project.toml\ndry run: nothing written" });
    if (init?.method === "POST" && u.pathname === "/api/v1/verbs/project/import")
      return json({
        ok: true,
        data: {
          file: `${ROOT}\\shop\\Shop.code-workspace`,
          candidates: [{ name: "shop-api", abs: "D:/code/shop-api", id: "shop-api", add: true }],
          folders: ["shop-api"],
        },
        text: "+ projects/shop-api/project.toml",
      });
    return json({ ok: false, error: { rule: "not-found", message: `no route ${u.pathname}` } }, 404);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const posts = (spy: ReturnType<typeof mockFetch>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input) === `/api/v1${path}`)
    .map(([, init]) => JSON.parse(String(init!.body)) as { input: Record<string, unknown>; dry_run?: boolean });
const lists = (spy: ReturnType<typeof mockFetch>) =>
  spy.mock.calls.filter(([i]) => String(i).startsWith("/api/v1/fs/list")).map(([i]) => new URL(String(i), "http://x").searchParams);

function renderAdd() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <Providers client={client}>
      <MemoryRouter>
        <AddProject />
      </MemoryRouter>
    </Providers>,
  );
}
const picker = (name: RegExp) => screen.findByRole("dialog", { name });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("PathPicker", () => {
  it("crumbs splits Windows and POSIX paths", () => {
    expect(crumbs("D:\\code\\shop").map((c) => c.path)).toEqual(["D:\\", "D:\\code", "D:\\code\\shop"]);
    expect(crumbs("/home/sam").map((c) => [c.label, c.path])).toEqual([
      ["/", "/"],
      ["home", "/home"],
      ["sam", "/home/sam"],
    ]);
  });

  it("folder mode: navigate in, up through the breadcrumb, select a folder; it fills the input, runs the dry run and is remembered", async () => {
    const spy = mockFetch();
    renderAdd();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    const dlg = await picker(/Choose a folder/);
    const list = await within(dlg).findByRole("list", { name: "Folder contents" });
    // chips, drives and shortcuts
    const wms = within(list).getByRole("button", { name: /wms-api/ });
    expect(wms).toHaveTextContent("git repo");
    expect(within(list).getByRole("button", { name: /shop/ })).toHaveTextContent("has workspace file");
    const places = within(dlg).getByRole("navigation", { name: "Places" });
    expect(within(places).getByRole("button", { name: "C:\\" })).toBeInTheDocument();
    expect(within(places).getByRole("button", { name: "Home" })).toBeInTheDocument();
    // filter
    fireEvent.change(within(dlg).getByPlaceholderText("Filter this folder"), { target: { value: "wms" } });
    expect(within(list).queryByRole("button", { name: /shop/ })).not.toBeInTheDocument();
    // Enter opens a folder
    fireEvent.keyDown(within(list).getByRole("button", { name: /wms-api/ }), { key: "Enter" });
    await within(dlg).findByRole("button", { name: /wms-api\\src/ });
    expect(lists(spy).at(-1)?.get("path")).toBe(`${ROOT}\\wms-api`);
    // the breadcrumb goes back up, double-click opens again
    const crumbsNav = within(dlg).getByRole("navigation", { name: "Current folder" });
    fireEvent.click(within(crumbsNav).getByRole("button", { name: "code" }));
    fireEvent.doubleClick(await within(dlg).findByRole("button", { name: /wms-api/ }));
    await within(dlg).findByRole("button", { name: /wms-api\\src/ });
    fireEvent.click(within(dlg).getByRole("button", { name: "Select this folder" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/Repo folder/)).toHaveValue(`${ROOT}\\wms-api`);
    await waitFor(() =>
      expect(posts(spy, "/verbs/project/add")).toEqual([{ input: { folder: "wms-api", path: `${ROOT}\\wms-api`, id: "wms-api" }, dry_run: true }]),
    );
    expect(await screen.findByText(/projects\/wms-api\/project.toml/)).toBeInTheDocument();
    expect(readRecentPicks("folder")).toEqual([`${ROOT}\\wms-api`]);
    // the recent pick shows as a shortcut next time; the picker starts at the typed path
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    const again = await picker(/Choose a folder/);
    expect(within(again).getByTitle(`Recent: ${ROOT}\\wms-api`)).toBeInTheDocument();
    const here = within(within(again).getByRole("navigation", { name: "Current folder" })).getByText("wms-api");
    expect(here).toHaveAttribute("aria-current", "location");
  });

  it("a bad typed path shows the server's message and keeps the places", async () => {
    mockFetch();
    renderAdd();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    const dlg = await picker(/Choose a folder/);
    await within(dlg).findByRole("list", { name: "Folder contents" });
    const box = within(dlg).getByLabelText("Path");
    fireEvent.change(box, { target: { value: "D:\\nope" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Go" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(/does not exist/);
    fireEvent.click(within(within(dlg).getByRole("navigation", { name: "Places" })).getByRole("button", { name: "D:\\" }));
    await waitFor(() => expect(within(dlg).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("workspace mode: clicking a .code-workspace file picks it and reads its folders", async () => {
    const spy = mockFetch();
    renderAdd();
    fireEvent.click(screen.getByRole("button", { name: "Import a .code-workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    const dlg = await picker(/Choose a .code-workspace file/);
    const list = await within(dlg).findByRole("list", { name: "Folder contents" });
    expect(within(list).getByRole("button", { name: /Team.code-workspace/ })).toBeInTheDocument();
    expect(lists(spy).at(-1)?.get("mode")).toBe("workspace");
    expect(within(dlg).queryByRole("button", { name: "Select this folder" })).not.toBeInTheDocument();
    fireEvent.doubleClick(within(list).getByRole("button", { name: /^shop/ }));
    fireEvent.click(await within(dlg).findByRole("button", { name: /Shop.code-workspace/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const file = `${ROOT}\\shop\\Shop.code-workspace`;
    expect(screen.getByLabelText(/\.code-workspace file/)).toHaveValue(file);
    await waitFor(() => expect(posts(spy, "/verbs/project/import")).toEqual([{ input: { file }, dry_run: true }]));
    expect(await screen.findByRole("group", { name: "Folders to add" })).toBeInTheDocument();
    expect(readRecentPicks("workspace")).toEqual([file]);
  });
});
