import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { invalidateAreas } from "@/api/live";
import { parseTomlForDisplay } from "@/components/viewers/toml";
import { renderApp } from "./render";

describe("overview", () => {
  it("renders needs-you first, with links to the tickets", async () => {
    renderApp("/");
    const list = await screen.findByRole("list", { name: "Needs you" });
    expect(within(list).getByText("Can a customer use two gift cards on one order?")).toBeInTheDocument();
    expect(within(list).getByText("T-004-sa blocked: Finance to confirm rounding rule")).toBeInTheDocument();
    expect(within(list).getAllByText("T-001-sa").length).toBeGreaterThan(0);
    // Stat card count and the stage funnel.
    expect(screen.getByText("Needs you", { selector: "p" }).nextSibling).toHaveTextContent("2");
    expect(screen.getByRole("list", { name: "Tickets by stage" })).toHaveTextContent("Spec2");
    // Runs: a run that did nothing is labelled.
    expect(screen.getByText("no-op")).toBeInTheDocument();
    // Console name from /workspace.
    expect(await screen.findByText("Test Console")).toBeInTheDocument();
  });

  it("j then Enter opens the selected needs-you item", async () => {
    renderApp("/");
    await screen.findByRole("list", { name: "Needs you" });
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByRole("heading", { level: 1, name: /Gift card redemption at checkout/ })).toBeInTheDocument();
  });
});

describe("board", () => {
  it("shows lanes from /board with counts and WIP as n/limit", async () => {
    renderApp("/tickets");
    const spec = await screen.findByRole("listitem", { name: "Spec lane" });
    expect(within(spec).getByText("2")).toBeInTheDocument();
    expect(within(spec).getByText("T-001-sa")).toBeInTheDocument();
    expect(within(spec).getByText("blocked")).toBeInTheDocument();
    const build = screen.getByRole("listitem", { name: "Build lane" });
    expect(within(build).getByLabelText("WIP 1 of 6")).toHaveTextContent("1/6");
    expect(screen.getAllByRole("listitem", { name: /lane$/ })).toHaveLength(6);
  });

  it("filters by blocked and opens the drawer with the gate", async () => {
    renderApp("/tickets");
    await screen.findByRole("listitem", { name: "Spec lane" });
    fireEvent.click(screen.getByRole("button", { name: /Blocked/ }));
    expect(screen.queryByText("Gift card redemption at checkout")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Fix rounding in tax totals"));
    const drawer = await screen.findByTestId("ticket-drawer");
    expect(within(drawer).getByText(/Move to Plan: blocked by ticket is blocked/)).toBeInTheDocument();
    expect(within(drawer).getByText("hl ticket move T-004-sa plan")).toBeInTheDocument();
  });

  it("toggles to the list view and remembers it", async () => {
    renderApp("/tickets");
    await screen.findByRole("listitem", { name: "Spec lane" });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const list = screen.getByRole("list", { name: "Tickets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("list", { name: "Board" })).not.toBeInTheDocument();
    expect(localStorage.getItem("hl.tickets.view")).toBe("list");
  });
});

describe("ticket page", () => {
  it("shows chips, the gate as 'Move to <stage>: blocked by', and the decisions table", async () => {
    renderApp("/t/T-001-sa");
    expect(await screen.findByRole("heading", { level: 1, name: /T-001-sa/ })).toBeInTheDocument();
    expect(screen.getByText("Stage: Spec")).toBeInTheDocument();
    expect(screen.getByTestId("gate-notice")).toHaveTextContent("Move to Plan: blocked by Q-001-sa is open and blocking");
    expect(screen.getByText("hl ticket move T-001-sa plan")).toBeInTheDocument();
    const decisions = screen.getAllByRole("table", { name: "Decisions" })[0]!;
    expect(within(decisions).getByText("D-001-sa")).toBeInTheDocument();
    expect(within(decisions).getByText("Gift card service")).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Ticket sections" });
    for (const t of ["Overview", "Thread 1", "Runs 1", "Decisions 1", "Questions 1", "Tasks 0", "Files 6"])
      expect(within(tabs).getByRole("tab", { name: t })).toBeInTheDocument();
  });

  it("switches tabs: thread, questions, files", async () => {
    renderApp("/t/T-001-sa");
    await screen.findByRole("tablist", { name: "Ticket sections" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Thread 1" }), { button: 0 });
    expect(await screen.findByText("Spec draft ready for review")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Questions 1" }), { button: 0 });
    expect(await screen.findByText('hl question answer Q-001-sa "<answer>"')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files 6" }), { button: 0 });
    expect(await screen.findByRole("link", { name: /comments\.jsonl|Comments/ })).toHaveAttribute("href", "/t/T-001-sa/comments.jsonl");
  });

  it("shows tasks with the AC trace", async () => {
    renderApp("/t/T-002-sa?tab=tasks");
    const trace = await screen.findByRole("list", { name: "AC trace" });
    expect(trace).toHaveTextContent("AC-1");
    expect(trace).toHaveTextContent("S1-T1, S1-T2");
    expect(trace).toHaveTextContent("1/2 done");
  });
});

describe("artifact viewer per kind", () => {
  it("renders markdown and drops raw html", async () => {
    const { container } = renderApp("/t/T-001-sa/T-001-sa-spec.md");
    expect(await screen.findByRole("heading", { level: 1, name: "T-001-sa Gift card redemption" })).toBeInTheDocument();
    expect(screen.getByText(/AC-1/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders TOML as a table", async () => {
    renderApp("/t/T-001-sa/decisions~D-001-sa.toml");
    const view = await screen.findByTestId("toml-view");
    expect(within(view).getByRole("rowheader", { name: "chosen" }).nextSibling).toHaveTextContent("Gift card service");
    expect(within(view).getByRole("rowheader", { name: "rejected" }).nextSibling).toHaveTextContent("Order table");
  });

  it("renders JSONL as a timeline", async () => {
    renderApp("/t/T-001-sa/comments.jsonl");
    const view = await screen.findByTestId("jsonl-view");
    expect(within(view).getByText("Spec draft ready for review")).toBeInTheDocument();
    expect(within(view).getByText("sam")).toBeInTheDocument();
  });

  it("renders HTML in a sandboxed iframe", async () => {
    renderApp("/t/T-001-sa/brief.html");
    const frame = await screen.findByTitle("Brief");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("");
  });
});

describe("palette and keys", () => {
  it("opens with Ctrl+K and lists pages, tickets and the open ticket's files", async () => {
    renderApp("/t/T-001-sa");
    await screen.findByRole("heading", { level: 1, name: /T-001-sa/ });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Pages")).toBeInTheDocument();
    expect(await within(dialog).findByText("Files of T-001-sa")).toBeInTheDocument();
    expect(await within(dialog).findByText("Export orders to CSV")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("Export orders to CSV"));
    expect(await screen.findByRole("heading", { level: 1, name: /Export orders to CSV/ })).toBeInTheDocument();
  });

  it("g then t goes to tickets; ? opens help", async () => {
    renderApp("/");
    await screen.findByRole("list", { name: "Needs you" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "t" });
    expect(await screen.findByRole("listitem", { name: "Spec lane" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "?" });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("toggle switches palette and persists in localStorage", async () => {
    const { unmount } = renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("hl.theme")).toBe("dark");
    unmount();
    renderApp("/");
    expect(await screen.findByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("api and live updates", () => {
  it("turns an error envelope into ApiError", async () => {
    await expect(api.ticket("T-999-xx")).rejects.toBeInstanceOf(ApiError);
    await expect(api.ticket("T-999-xx")).rejects.toMatchObject({ rule: "not-found", status: 404 });
  });

  it("invalidates query roots by change area", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await act(async () => invalidateAreas(qc, ["records", "worklog"]));
    const roots = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(roots).toEqual(expect.arrayContaining(["ticket", "board", "overview", "worklog"]));
    expect(roots).not.toContain("runs");
    expect(new Set(roots).size).toBe(roots.length);
  });
});

describe("toml display parser", () => {
  it("reads tables, arrays of tables, arrays and comments", () => {
    const s = parseTomlForDisplay('a = 1 # c\n[t]\nx = "y # not a comment"\n[[task]]\nid = "S1"\nacs = [\n  "AC-1",\n  "AC-2",\n]\n[[task]]\nid = "S2"\n');
    expect(s.map((x) => [x.name, x.index])).toEqual([
      ["", undefined],
      ["t", undefined],
      ["task", 0],
      ["task", 1],
    ]);
    expect(s[1]!.rows[0]!.value).toBe("y # not a comment");
    expect(s[2]!.rows.find((r) => r.key === "acs")!.value).toBe("AC-1, AC-2");
  });
});

it("waits for the board before the drawer opens (no flash of empty lanes)", async () => {
  renderApp("/tickets?t=T-002-sa");
  await waitFor(() => expect(screen.getByTestId("ticket-drawer")).toHaveTextContent("Export orders to CSV"));
});
