// The Work page (work log rebuild): quick add with live validation, quick picks, suggested entries, inline edit and
// delete, the week grid's gaps, copy timesheet and standup, view switching, search and the nav badge. Fetch is faked.
import type { WorkConfigView, WorkDaySheet, WorkRangeView, WorkSearchResult, WorkSuggestions } from "@helmlock/core/contracts";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cards } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";
import { addDays, iso, mondayOf, previousWorkday, standupText, textProblem, timesheetText } from "./work/text";

// The lazy Work route transforms cold on the first test; the full suite runs files in parallel.
configure({ asyncUtilTimeout: 15000 });

const TODAY = iso(new Date());
const MONDAY = mondayOf(TODAY);
const YESTERDAY = previousWorkday(TODAY);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });

function sheet(date: string, author: string, name: string, over: Partial<WorkDaySheet> = {}): WorkDaySheet {
  return {
    date,
    author,
    name,
    file: `logs/${date.slice(0, 7)}/${date}.${author}.toml`,
    hash: `hash-${author}-${date}`,
    floor: 8,
    total: 8.5,
    billable: 8,
    internal: 0.5,
    pinned: 0,
    length: 8,
    shortfall: 0,
    overtime: 0,
    inferred_length: false,
    entries: [
      {
        index: 0,
        id: "e111111",
        ticket: "T-001-sa",
        category: "Development",
        text: "Wrote the gift card reader",
        weight: 3,
        hours_alloc: 8,
        pinned: false,
        logged: `${date}T10:00:00`,
        source: "agent-run:r-9",
      },
      {
        index: 1,
        id: "e222222",
        ticket: "Internal",
        category: "Internal",
        text: "Daily scrum",
        hours: 0.5,
        hours_alloc: 0.5,
        pinned: true,
        logged: `${date}T09:00:00`,
      },
    ],
    tickets: [
      { ticket: "T-001-sa", hours: 8, pinned: false, categories: [{ category: "Development", hours: 8, lines: ["Wrote the gift card reader"] }] },
      { ticket: "Internal", hours: 0.5, pinned: true, categories: [{ category: "Internal", hours: 0.5, lines: ["Daily scrum"] }] },
    ],
    categories: [
      { category: "Development", hours: 8 },
      { category: "Internal", hours: 0.5 },
    ],
    ...over,
  };
}

const config: WorkConfigView = {
  floor: 8,
  categories: ["Development", "Code Review", "Testing", "Design", "Documentation", "Internal"],
  quick_picks: [{ label: "Standup", ticket: "Internal", category: "Internal", hours: 0.25 }],
  internal_ticket: "Internal",
  max_text: 160,
  me: { id: "sam", name: "Sam Abbott" },
  authors: [
    { id: "sam", name: "Sam Abbott" },
    { id: "ann", name: "Ann Lee" },
  ],
};

function weekRange(author: string | null): WorkRangeView {
  const days = [
    { date: MONDAY, author: "sam", total: 8, shortfall: 0, overtime: 0, inferred_length: false },
    { date: addDays(MONDAY, 6), author: "ann", total: 2, shortfall: 0, overtime: 0, inferred_length: false },
  ].filter((d) => !author || d.author === author);
  const cells = [
    { date: MONDAY, author: "sam", ticket: "T-001-sa", hours: 8 },
    { date: addDays(MONDAY, 6), author: "ann", ticket: "T-002-sa", hours: 2 },
  ].filter((c) => !author || c.author === author);
  return {
    start: MONDAY,
    end: addDays(MONDAY, 6),
    author,
    total: days.reduce((s, d) => s + d.total, 0),
    days_logged: days.length,
    files: days.length,
    span_days: 7,
    by_day: Array.from({ length: 7 }, (_, i) => ({ key: addDays(MONDAY, i), hours: days.find((d) => d.date === addDays(MONDAY, i))?.total ?? 0 })),
    by_ticket: [{ key: "T-001-sa", hours: 8 }],
    by_category: [{ key: "Development", hours: 8 }],
    by_author: [{ key: "sam", hours: 8 }],
    days,
    cells,
  };
}

type Post = { path: string; body: { input: Record<string, unknown>; dry_run?: boolean } };

function mock(reply: (p: Post) => unknown = () => ({ ok: true, data: { written: true }, text: "logged" })) {
  const posts: Post[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    const p = u.pathname.replace(/^\/api\/v1/, "");
    const q = (k: string) => u.searchParams.get(k) ?? undefined;
    if (init?.method === "POST") {
      const post = { path: p, body: JSON.parse(String(init.body)) };
      posts.push(post);
      return json(reply(post));
    }
    if (p === "/worklog/config") return ok(config);
    if (p === "/worklog/day") {
      const date = q("date")!;
      const author = q("author");
      const list: WorkDaySheet[] = [];
      if (date === TODAY || date === YESTERDAY) {
        list.push(
          sheet(
            date,
            "sam",
            "Sam Abbott",
            date === YESTERDAY ? { entries: [{ ...sheet(date, "sam", "Sam").entries[0]!, text: "Fixed the tax rounding" }] } : {},
          ),
        );
        if (!author && date === TODAY) list.push(sheet(date, "ann", "Ann Lee", { hash: "hash-ann" }));
      }
      return ok({ date, floor: 8, sheets: list });
    }
    if (p === "/worklog/range") {
      const author = q("author");
      return ok(weekRange(author === "me" ? "sam" : (author ?? null)));
    }
    if (p === "/worklog/search") {
      const res: WorkSearchResult = {
        query: q("q")!,
        total: 1,
        hits: [{ ...sheet(TODAY, "sam", "Sam").entries[0]!, date: "2026-09-02", author: "sam" }],
      };
      return ok(res);
    }
    if (p === "/worklog/suggestions") {
      const s: WorkSuggestions = {
        date: q("date")!,
        author: "sam",
        items: [
          {
            key: "run:r-7",
            kind: "run",
            ticket: "T-002-sa",
            text: "Wrote the CSV writer",
            source: "agent-run:r-7",
            at: `${TODAY}T11:00:00Z`,
            detail: "builder run done at 11:00",
          },
        ],
      };
      return ok(s);
    }
    return route(href);
  });
  vi.stubGlobal("fetch", spy);
  return posts;
}

let clip: string[] = [];
beforeEach(() => {
  clip = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (t: string) => {
        clip.push(t);
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Work page: quick add", () => {
  it("validates live with the verb's rules, then sends log-work with category, weight and date", async () => {
    const posts = mock();
    renderApp("/work");
    const text = await screen.findByLabelText(/What did you do/);
    const form = screen.getByRole("form", { name: "Log work" });
    fireEvent.change(text, { target: { value: "The builder agent wrote the parser" } });
    expect(within(form).getByRole("alert")).toHaveTextContent('No "builder"');
    expect(within(form).getByRole("button", { name: "Log" })).toBeDisabled();
    fireEvent.change(text, { target: { value: "x".repeat(161) } });
    expect(screen.getByTestId("text-counter")).toHaveTextContent("161/160");
    expect(within(form).getByRole("alert")).toHaveTextContent("Shorten to 160 characters");
    fireEvent.change(text, { target: { value: "Shipped the parser: done" } });
    expect(within(form).getByRole("alert")).toHaveTextContent('No ":"');

    fireEvent.change(text, { target: { value: "Wrote the parser" } });
    expect(screen.getByTestId("text-counter")).toHaveTextContent("16/160");
    fireEvent.change(within(form).getByLabelText(/^Ticket/), { target: { value: "T-001-sa" } });
    fireEvent.click(within(form).getByRole("button", { name: "Testing" }));
    fireEvent.click(within(form).getByRole("button", { name: "Weight 4" }));
    fireEvent.click(within(form).getByRole("button", { name: "Log" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/verbs/log-work");
    expect(posts[0]!.body.input).toEqual({ ticket: "T-001-sa", text: "Wrote the parser", category: "Testing", weight: 4, date: TODAY });
    await waitFor(() => expect(text).toHaveValue(""));
  });

  it("shows a skipped duplicate as a calm result and keeps the sentence", async () => {
    mock(() => ({ ok: true, data: { written: false, reason: "duplicate" }, text: "skipped (duplicate of an entry already logged today)" }));
    renderApp("/work");
    const form = await screen.findByRole("form", { name: "Log work" });
    fireEvent.change(within(form).getByLabelText(/What did you do/), { target: { value: "Wrote the parser" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Skipped: duplicate.");
    expect(within(form).getByLabelText(/What did you do/)).toHaveValue("Wrote the parser");
  });

  it("a quick pick fills ticket, category and pinned hours", async () => {
    const posts = mock();
    renderApp("/work");
    const form = await screen.findByRole("form", { name: "Log work" });
    fireEvent.click(await within(form).findByRole("button", { name: /Standup/ }));
    expect(within(form).getByLabelText(/^Ticket/)).toHaveValue("Internal");
    expect(within(form).getByLabelText("Hours")).toHaveValue(0.25);
    fireEvent.click(within(form).getByRole("button", { name: "Log" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.input).toMatchObject({ ticket: "Internal", text: "Standup", category: "Internal", hours: 0.25 });
  });

  it("a suggested entry pre-fills the quick add with its source; nothing is written until Log", async () => {
    const posts = mock();
    renderApp("/work");
    fireEvent.click(await screen.findByRole("button", { name: "Log run:r-7" }));
    const form = screen.getByRole("form", { name: "Log work" });
    expect(within(form).getByLabelText(/What did you do/)).toHaveValue("Wrote the CSV writer");
    expect(within(form).getByLabelText(/^Ticket/)).toHaveValue("T-002-sa");
    expect(within(form).getByText("agent-run:r-7")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    fireEvent.click(within(form).getByRole("button", { name: "Log" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.input).toMatchObject({ ticket: "T-002-sa", text: "Wrote the CSV writer", source: "agent-run:r-7" });
  });
});

describe("Work page: day view", () => {
  it("shows the author card with total, pinned and allocated hours, and a source link to the run", async () => {
    mock();
    renderApp("/work");
    const card = await screen.findByRole("region", { name: `Sam Abbott on ${TODAY}` });
    expect(within(card).getByText("8.5h")).toBeInTheDocument();
    expect(within(card).getByText("0.5h pinned")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /run r-9/ })).toHaveAttribute("href", "/runs/r-9");
    expect(within(card).getByText("not stated")).toBeInTheDocument();
  });

  it("edits a line inline and sends log edit with the entry id and the file hash", async () => {
    const posts = mock(() => ({ ok: true, data: {}, text: "changed" }));
    renderApp("/work");
    const card = await screen.findByRole("region", { name: `Sam Abbott on ${TODAY}` });
    fireEvent.click(within(card).getByRole("button", { name: "Edit: Wrote the gift card reader" }));
    const edit = within(card).getByRole("form", { name: "Edit entry" });
    fireEvent.change(within(edit).getByLabelText("Edit text"), { target: { value: "Wrote the gift card reader and tests" } });
    fireEvent.change(within(edit).getByLabelText("Edit category"), { target: { value: "Testing" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/verbs/log/edit");
    expect(posts[0]!.body.input).toEqual({
      date: TODAY,
      entry: "e111111",
      hash: `hash-sam-${TODAY}`,
      text: "Wrote the gift card reader and tests",
      category: "Testing",
    });
    await waitFor(() => expect(within(card).queryByRole("form", { name: "Edit entry" })).toBeNull());
  });

  it("deletes a line after an in-page confirmation (no browser confirm)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const posts = mock(() => ({ ok: true, data: {}, text: "removed" }));
    renderApp("/work");
    const card = await screen.findByRole("region", { name: `Sam Abbott on ${TODAY}` });
    fireEvent.click(within(card).getByRole("button", { name: "Delete: Daily scrum" }));
    const group = within(card).getByRole("group", { name: "Confirm delete" });
    fireEvent.click(within(group).getByRole("button", { name: "Keep" }));
    expect(posts).toHaveLength(0);
    fireEvent.click(within(card).getByRole("button", { name: "Delete: Daily scrum" }));
    fireEvent.click(within(within(card).getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/verbs/log/remove");
    expect(posts[0]!.body.input).toEqual({ date: TODAY, entry: "e222222", hash: `hash-sam-${TODAY}` });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("states the day length through log day-hours", async () => {
    const posts = mock(() => ({ ok: true, data: {}, text: "set" }));
    renderApp("/work");
    const card = await screen.findByRole("region", { name: `Sam Abbott on ${TODAY}` });
    fireEvent.click(within(card).getByRole("button", { name: "Day length" }));
    fireEvent.change(within(card).getByLabelText("Day length (hours)"), { target: { value: "10.5" } });
    fireEvent.click(within(within(card).getByRole("form", { name: "Day length" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/verbs/log/day-hours");
    expect(posts[0]!.body.input).toEqual({ date: TODAY, hours: 10.5, hash: `hash-sam-${TODAY}` });
  });

  it("other people's cards have no edit or delete", async () => {
    mock();
    renderApp("/work");
    fireEvent.change(await screen.findByLabelText("Author"), { target: { value: "" } });
    const ann = await screen.findByRole("region", { name: `Ann Lee on ${TODAY}` });
    expect(within(ann).queryByRole("button", { name: /^Edit:/ })).toBeNull();
    expect(within(ann).queryByRole("button", { name: /^Delete:/ })).toBeNull();
  });
});

describe("Work page: views, search, timesheet", () => {
  it("week grid shows people x days with gaps on weekdays nothing was logged; a cell opens that day", async () => {
    mock();
    renderApp("/work");
    fireEvent.change(await screen.findByLabelText("Author"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const grid = await screen.findByRole("table", { name: "Week grid" });
    const annMonday = within(grid).getByRole("button", { name: `Ann Lee on ${MONDAY}: gap, nothing logged` });
    expect(annMonday).toHaveAttribute("data-gap", "true");
    const samMonday = within(grid).getByRole("button", { name: `Sam Abbott on ${MONDAY}: 8h` });
    expect(samMonday).not.toHaveAttribute("data-gap");
    fireEvent.click(samMonday);
    expect(await within(screen.getByRole("toolbar", { name: "Work view" })).findByLabelText("Date")).toHaveValue(MONDAY);
    expect(within(screen.getByRole("form", { name: "Log work" })).getByLabelText("Date")).toHaveValue(MONDAY);
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("month view shows summary chips and bar panels with a values table twin", async () => {
    mock();
    renderApp("/work");
    fireEvent.click(await screen.findByRole("button", { name: "Month" }));
    expect(await screen.findByText("8h total")).toBeInTheDocument();
    const byTicket = screen.getByRole("region", { name: "Hours by ticket" });
    fireEvent.click(within(byTicket).getByRole("button", { name: "Show values" }));
    const table = within(byTicket).getByRole("table", { name: "Hours by ticket values" });
    expect(within(table).getByText("T-001-sa")).toBeInTheDocument();
    for (const t of ["Hours by day", "Hours by category", "Hours by author"]) expect(screen.getByRole("region", { name: t })).toBeInTheDocument();
  });

  it("search results replace the entries panel", async () => {
    mock();
    renderApp("/work");
    await screen.findByRole("region", { name: `Sam Abbott on ${TODAY}` });
    fireEvent.change(screen.getByLabelText("Search the work log"), { target: { value: "cat:development -ticket:Internal" } });
    const results = await screen.findByRole("table", { name: "Search results" });
    expect(within(results).getByText("2026-09-02")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: `Sam Abbott on ${TODAY}` })).toBeNull();
  });

  it("copies the timesheet and the standup", async () => {
    mock();
    renderApp("/work");
    const ts = await screen.findByRole("region", { name: "Timesheet" });
    expect(await within(ts).findByRole("table", { name: "Timesheet of Sam Abbott" })).toBeInTheDocument();
    fireEvent.click(within(ts).getByRole("button", { name: "Copy timesheet" }));
    await waitFor(() => expect(clip).toHaveLength(1));
    expect(clip[0]).toContain("Work summary");
    expect(clip[0]).toContain("Ticket T-001-sa\nHours 8\nDevelopment\n- Wrote the gift card reader");
    await waitFor(() => expect(within(ts).getByRole("button", { name: "Copy standup" })).toBeEnabled());
    fireEvent.click(within(ts).getByRole("button", { name: "Copy standup" }));
    await waitFor(() => expect(clip).toHaveLength(2));
    expect(clip[1]).toContain(`Yesterday (${YESTERDAY})\n- T-001-sa Fixed the tax rounding`);
    expect(clip[1]).toContain("Blockers\n- T-004-sa Fix rounding in tax totals blocked by Finance to confirm rounding rule");
  });

  it("the Work nav item shows today's logged hours", async () => {
    mock();
    renderApp("/");
    expect(await screen.findByTestId("work-badge")).toHaveTextContent("8.5h");
  });
});

describe("Work text helpers", () => {
  it("textProblem mirrors the verb", () => {
    expect(textProblem("Wrote the parser")).toBeUndefined();
    expect(textProblem("Used Claude for it")).toMatch(/claude/);
    expect(textProblem("It’s done")).toMatch(/’/);
  });

  it("timesheetText states internal, shortfall, overtime and an unknown length like lc-wms", () => {
    const t = timesheetText([sheet("2026-10-07", "sam", "Sam Abbott", { shortfall: 1, overtime: 2, inferred_length: true })]);
    expect(t.split("\n").slice(0, 8)).toEqual([
      "Work summary",
      "Date 2026-10-07",
      "Author Sam Abbott",
      "Total hours 8.5",
      "",
      "Billable hours 8",
      "Internal hours 0.5 vault only excluded from the contractual minimum",
      "",
    ]);
    expect(t).toContain("Unaccounted hours 1 add an entry");
    expect(t).toContain("Overtime hours 2 beyond the 8 hour minimum");
    expect(t).toContain("Day length not stated");
    expect(t.trimEnd().endsWith("Total hours 8.5")).toBe(true);
    expect(timesheetText([])).toBe("No work logged.\n");
  });

  it("standupText lists yesterday, today with my open tickets, and blockers", () => {
    const s = standupText({ date: TODAY, me: "sam", yesterday: sheet(YESTERDAY, "sam", "Sam"), tickets: cards });
    expect(s).toContain("Today\n- T-001-sa Gift card redemption at checkout (spec)");
    expect(s).not.toContain("- T-004-sa Fix rounding in tax totals (spec)");
    expect(s).toContain("Blockers\n- T-004-sa");
  });
});
