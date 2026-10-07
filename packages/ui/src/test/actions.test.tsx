// Ticket actions (milestone 3, W2): every write is POST /api/v1/verbs/<noun>/<verb> with the write header and { input }.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "./render";
import { route } from "./server";

interface Call {
  path: string;
  headers: Record<string, string>;
  body: { input: Record<string, unknown>; dry_run?: boolean };
}
type Reply = { status?: number; body: unknown };

/** Mocked fetch: GETs answer from the fixtures; POSTs are recorded and answered by `reply` (default: ok). */
function mockWrites(reply: (c: Call) => Reply | Promise<Reply> = () => ({ body: { ok: true, data: {} } })) {
  const calls: Call[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if ((init?.method ?? "GET") !== "POST") return route(url);
    const c: Call = { path: new URL(url, "http://localhost").pathname, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
    calls.push(c);
    const r = await reply(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

function expectWrite(c: Call | undefined, path: string, input: Record<string, unknown>) {
  expect(c).toBeDefined();
  expect(c!.path).toBe(path);
  expect(c!.headers["X-Helmlock-Request"]).toBe("1");
  expect(c!.headers["Content-Type"]).toBe("application/json");
  expect(c!.body).toEqual({ input });
}

const blocked = {
  status: 409,
  body: {
    ok: false,
    code: 2,
    error: {
      rule: "gate:no-blocking-questions",
      message: "Q-001-sa is open and blocking\n- gate:no-blocking-questions: Q-001-sa is open and blocking\n- gate:spec-frozen: spec is not frozen",
      fix: 'hl question answer Q-001-sa "<answer>"',
      file: "artifacts/T-001-sa/ticket.toml",
    },
  },
};

/** A native drag of a card onto a lane, the way Pragmatic drag and drop sees it in a browser. */
function dragCardToLane(card: HTMLElement, lane: HTMLElement) {
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
  fireEvent.dragStart(card, { dataTransfer, clientX: 5, clientY: 5 });
  fireEvent.dragEnter(lane, { dataTransfer, clientX: 50, clientY: 50 });
  fireEvent.dragOver(lane, { dataTransfer, clientX: 50, clientY: 50 });
  fireEvent.drop(lane, { dataTransfer, clientX: 50, clientY: 50 });
}

describe("new ticket", () => {
  it("c opens the composer; create sends ticket new and opens the new ticket", async () => {
    const calls = mockWrites(() => ({ body: { ok: true, data: { ticket: { ticket: { id: "T-002-sa", stage: "backlog" } } } } }));
    renderApp("/tickets");
    await screen.findByRole("listitem", { name: "Spec lane" });
    fireEvent.keyDown(document.body, { key: "c" });
    const dialog = await screen.findByRole("dialog", { name: "New ticket" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "  Gift card refunds " } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Size" }), { target: { value: "S" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Priority" }), { target: { value: "high" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Export orders to CSV/ })).toBeInTheDocument();
    expectWrite(calls[0], "/api/v1/verbs/ticket/new", { title: "Gift card refunds", size: "S", priority: "high" });
    expect(screen.queryByRole("dialog", { name: "New ticket" })).not.toBeInTheDocument();
  });

  it("Preview sends a dry run and shows the files it would write", async () => {
    const calls = mockWrites(() => ({
      body: { ok: true, data: { dry_run: true, would_write: [{ path: "artifacts/T-006-sa/ticket.toml", text: 'title = "X"' }] }, text: "T-006-sa backlog X" },
    }));
    renderApp("/tickets");
    fireEvent.click(await screen.findByRole("button", { name: "New ticket" }));
    const dialog = await screen.findByRole("dialog", { name: "New ticket" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "X" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByTestId("dry-run")).toHaveTextContent("artifacts/T-006-sa/ticket.toml");
    expect(calls[0]!.body).toEqual({ input: { title: "X", size: "M", priority: "normal" }, dry_run: true });
  });
});

describe("board moves", () => {
  it("dragging a card to another lane sends ticket move", async () => {
    const calls = mockWrites();
    renderApp("/tickets");
    const spec = await screen.findByRole("listitem", { name: "Spec lane" });
    const plan = screen.getByRole("listitem", { name: "Plan lane" });
    const card = within(spec).getByText("Gift card redemption at checkout").closest("button")!;
    await act(async () => dragCardToLane(card, plan));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/ticket/move", { id: "T-001-sa", stage: "plan" });
    await waitFor(() => expect(within(plan).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("a blocked move (409, code 2) shows every gate reason with the fix in the lane and the card stays", async () => {
    const calls = mockWrites(() => blocked);
    renderApp("/tickets");
    const spec = await screen.findByRole("listitem", { name: "Spec lane" });
    const plan = screen.getByRole("listitem", { name: "Plan lane" });
    const card = within(spec).getByText("Gift card redemption at checkout").closest("button")!;
    await act(async () => dragCardToLane(card, plan));
    const alert = await within(plan).findByRole("alert");
    expect(alert).toHaveTextContent("Blocked: Q-001-sa is open and blocking");
    expect(alert).toHaveTextContent("spec is not frozen");
    expect(alert).toHaveTextContent('Fix: hl question answer Q-001-sa "<answer>"');
    expect(within(spec).getByText("Gift card redemption at checkout")).toBeInTheDocument();
    expect(within(plan).queryByText("Gift card redemption at checkout")).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
    // Dismiss clears the reasons.
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(within(plan).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the drawer's Move button is the keyboard alternative", async () => {
    const calls = mockWrites(() => blocked);
    renderApp("/tickets?t=T-001-sa");
    const drawer = await screen.findByTestId("ticket-drawer");
    fireEvent.click(within(drawer).getByRole("button", { name: "Move to Plan" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("spec is not frozen");
    expectWrite(calls[0], "/api/v1/verbs/ticket/move", { id: "T-001-sa", stage: "plan" });
  });
});

describe("ticket actions", () => {
  it("the stage menu moves to any other stage", async () => {
    const calls = mockWrites();
    renderApp("/t/T-002-sa");
    fireEvent.click(await screen.findByRole("button", { name: "Move to stage" }));
    const menu = screen.getByRole("list", { name: "Stages" });
    expect(within(menu).queryByRole("button", { name: "Build" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/ticket/move", { id: "T-002-sa", stage: "done" });
    expect(screen.queryByRole("list", { name: "Stages" })).not.toBeInTheDocument();
  });

  it("answers a question card with an option or free text", async () => {
    const calls = mockWrites();
    renderApp("/t/T-001-sa?tab=questions");
    const card = await screen.findByRole("article", { name: "Question Q-001-sa" });
    fireEvent.change(within(card).getByRole("textbox", { name: "Answer Q-001-sa" }), { target: { value: "Yes, up to two" } });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/question/answer", { id: "Q-001-sa", answer: "Yes, up to two" });
  });

  it("answers from the Overview needs-you card", async () => {
    const calls = mockWrites();
    renderApp("/");
    const card = await screen.findByRole("article", { name: "Question Q-001-sa" });
    fireEvent.change(within(card).getByRole("textbox", { name: "Answer Q-001-sa" }), { target: { value: "No" } });
    fireEvent.submit(within(card).getByRole("textbox", { name: "Answer Q-001-sa" }).closest("form")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/question/answer", { id: "Q-001-sa", answer: "No" });
  });

  it("comment box sends on Ctrl+Enter and clears", async () => {
    const calls = mockWrites();
    renderApp("/t/T-001-sa?tab=thread");
    const box = await screen.findByRole("textbox", { name: "Comment text" });
    fireEvent.change(box, { target: { value: "Spoke to Kim; table approved" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/ticket/comment", { id: "T-001-sa", text: "Spoke to Kim; table approved" });
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("a claim conflict shows the rule, message and fix next to the button", async () => {
    const calls = mockWrites(() => ({
      status: 422,
      body: { ok: false, code: 1, error: { rule: "claim-conflict", message: "T-004-sa is claimed by jo", fix: "Ask jo to release it" } },
    }));
    renderApp("/t/T-004-sa");
    fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("T-004-sa is claimed by jo");
    expect(alert).toHaveTextContent("claim-conflict");
    expect(alert).toHaveTextContent("Fix: Ask jo to release it");
    expectWrite(calls[0], "/api/v1/verbs/ticket/claim", { id: "T-004-sa" });
  });

  it("release is offered when you hold the claim", async () => {
    const calls = mockWrites();
    renderApp("/t/T-001-sa");
    fireEvent.click(await screen.findByRole("button", { name: "Release" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/ticket/release", { id: "T-001-sa" });
  });

  it("block needs by and next; unblock clears", async () => {
    const calls = mockWrites();
    renderApp("/t/T-002-sa");
    fireEvent.click(await screen.findByRole("button", { name: "Block…" }));
    const form = screen.getByRole("form", { name: "Block ticket" });
    expect(within(form).getByRole("button", { name: "Block" })).toBeDisabled();
    fireEvent.change(within(form).getByRole("textbox", { name: "Blocked by (who or what)" }), { target: { value: "DBA review" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Next action" }), { target: { value: "Ask Kim" } });
    fireEvent.click(within(form).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/ticket/block", { id: "T-002-sa", by: "DBA review", next: "Ask Kim" });
  });

  it("task status toggles optimistically and rolls back when refused", async () => {
    let refuse = false;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls = mockWrites(async () => {
      await gate; // hold the server answer so the optimistic state is visible
      return refuse ? { status: 422, body: { ok: false, code: 1, error: { rule: "bad-input", message: "task is locked" } } } : { body: { ok: true, data: {} } };
    });
    renderApp("/t/T-002-sa?tab=tasks");
    const sel = await screen.findByRole("combobox", { name: "Status of S1-T2" });
    fireEvent.change(sel, { target: { value: "doing" } });
    await waitFor(() => expect(sel).toHaveValue("doing"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/task/set", { ticket: "T-002-sa", task: "S1-T2", status: "doing" });
    await act(async () => release());

    refuse = true;
    const sel1 = screen.getByRole("combobox", { name: "Status of S1-T1" });
    fireEvent.change(sel1, { target: { value: "blocked" } });
    expect(await screen.findByText("task is locked")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status of S1-T1" })).toHaveValue("done"));
  });

  it("adds a decision with the exact verb input keys", async () => {
    const calls = mockWrites();
    renderApp("/t/T-001-sa?tab=decisions");
    const form = await screen.findByRole("form", { name: "Add a decision" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Decision" }), { target: { value: "Store cards in SQL" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Chosen" }), { target: { value: "new table" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Rejected (comma separated)" }), { target: { value: "JSON column, Redis" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add decision" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/decision/add", {
      ticket: "T-001-sa",
      title: "Store cards in SQL",
      chosen: "new table",
      rejected: ["JSON column", "Redis"],
    });
  });

  it("asks a blocking question with options", async () => {
    const calls = mockWrites();
    renderApp("/t/T-001-sa?tab=questions");
    const form = await screen.findByRole("form", { name: "Ask a question" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Question" }), { target: { value: "Which catalog?" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Options (comma separated, optional)" }), { target: { value: "WMS, AMS" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.click(within(form).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/question/add", { ticket: "T-001-sa", text: "Which catalog?", blocking: true, option: ["WMS", "AMS"] });
  });

  it("resolves a bug with fixed-in", async () => {
    const calls = mockWrites();
    renderApp("/t/T-004-sa");
    fireEvent.click(await screen.findByRole("button", { name: "Resolve B-001-sa" }));
    const form = screen.getByRole("form", { name: "Resolve B-001-sa" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "commit 1a2b3c" } });
    fireEvent.click(within(form).getByRole("button", { name: "Mark fixed" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expectWrite(calls[0], "/api/v1/verbs/bug/resolve", { id: "B-001-sa", "fixed-in": "commit 1a2b3c" });
  });
});
