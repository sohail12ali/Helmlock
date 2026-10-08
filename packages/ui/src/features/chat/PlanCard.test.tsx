// Milestone 8 stream D: the assistant plan card renders a ledger and posts decisions.
import type { ChatMessageData, PlanCard as Plan, PlanDecision } from "@helmlock/core/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanCard } from "./PlanCard";

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "pl-1",
  title: "Spec and plan T-016",
  status: "proposed",
  steps: [
    { ticket: "T-016-sa", role: "analyst", task: "Write the spec", done_check: "spec frozen", status: "proposed" },
    { ticket: "T-016-sa", role: "planner", engine: "cursor", task: "Write the plan", done_check: "plan has slices", status: "proposed" },
    { ticket: "T-014-sa", role: "builder", task: "Build slice 1", done_check: "tests pass", status: "proposed" },
  ],
  ...over,
});
const msg = (p: Plan): ChatMessageData => ({ id: "m-1", role: "assistant", text: "plan", plan: p, ts: new Date().toISOString() });

function mockDecide(reply: (body: PlanDecision) => Plan) {
  const bodies: PlanDecision[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as PlanDecision;
    bodies.push(body);
    expect(String(input)).toBe("/api/v1/chats/ch-1/plans/pl-1");
    expect(new Headers(init?.headers).get("X-Helmlock-Request")).toBe("1");
    return new Response(JSON.stringify({ ok: true, data: reply(body) }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", spy);
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

const renderCard = (p: Plan, onChange = vi.fn()) => {
  render(
    <MemoryRouter>
      <PlanCard chatId="ch-1" message={msg(p)} onChange={onChange} />
    </MemoryRouter>,
  );
  return onChange;
};

describe("PlanCard", () => {
  it("renders the steps as a ledger with tickets, roles, engines and DONE checks", () => {
    renderCard(plan());
    const card = screen.getByRole("region", { name: "Plan: Spec and plan T-016" });
    const steps = within(card).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent("T-016-sa planner on cursor");
    expect(steps[1]).toHaveTextContent("DONE when: plan has slices");
    expect(within(steps[0] as HTMLElement).getByRole("link", { name: "T-016-sa" })).toHaveAttribute("href", "/t/T-016-sa");
    expect(within(card).getAllByRole("img", { name: "proposed" })).toHaveLength(3);
  });

  it("posts per-step toggles and shows the result: started with a run link, skipped, failed with the error", async () => {
    const bodies = mockDecide(() =>
      plan({
        status: "decided",
        steps: [
          { ...plan().steps[0]!, status: "started", run: "r-7" },
          { ...plan().steps[1]!, status: "skipped" },
          { ...plan().steps[2]!, status: "failed", error: "cursor is not signed in" },
        ],
      }),
    );
    const onChange = renderCard(plan());
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip step 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve step 3" }));
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("decided"));
    expect(bodies[0]).toEqual({ decisions: { "0": "approve", "1": "skip", "2": "approve" } });
    expect(screen.getByRole("link", { name: /Run r-7/ })).toHaveAttribute("href", "/t/T-016-sa");
    expect(screen.getByRole("img", { name: "skipped" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("cursor is not signed in");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "m-1", plan: expect.objectContaining({ status: "decided" }) }), false);
  });

  it("Approve all approves every proposed step; a waiting step gets Start", async () => {
    const bodies = mockDecide((b) => {
      const steps = plan().steps.map((s, i) => ({ ...s, status: b.decisions[String(i)] === "approve" ? ("approved" as const) : s.status }));
      return plan({ status: "decided", steps });
    });
    renderCard(plan());
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(3));
    expect(bodies[0]).toEqual({ decisions: { "0": "approve", "1": "approve", "2": "approve" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Start" })[1] as HTMLElement);
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ decisions: { "1": "approve" } });
  });

  it("Revise sends the text back to the assistant", async () => {
    const bodies = mockDecide(() => plan({ status: "decided", steps: plan().steps.map((s) => ({ ...s, status: "skipped" as const })) }));
    const onChange = renderCard(plan());
    fireEvent.click(screen.getByRole("button", { name: "Revise…" }));
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "only the spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ decisions: {}, revise: "only the spec" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.anything(), true));
  });
});
