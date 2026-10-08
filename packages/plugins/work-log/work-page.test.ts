// Work page backend: lc-wms allocation (floor, pins, overtime, Internal on top), log edit/remove/day-hours,
// day-length evidence from git and runs, suggested entries and the search syntax.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActivityLine, WorkLogEntry } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";
import { evidenceFor, scanGit, suggestLength } from "./evidence.ts";
import type { WorkLogFull } from "./index.ts";
import { allocateDay } from "./rules.ts";
import { draftSentence, suggestionsFor } from "./suggest.ts";
import { matches, parseQuery, rangeOf, sheetOf } from "./views.ts";

const DATE = "2026-10-07";
const FILE = `logs/2026-10/${DATE}.sam.toml`;

test("allocateDay: weights share the floor, pins stand, longer days are overtime, Internal is on top", () => {
  const a = allocateDay(
    [
      { ticket: "T-1", weight: 3 },
      { ticket: "T-2", hours: 2 },
      { ticket: "T-3", weight: 1 },
    ],
    8,
  );
  assert.deepEqual(a.hours, [4.5, 2, 1.5]);
  assert.equal(a.total, 8);
  assert.equal(a.overtime, 0);
  assert.equal(a.shortfall, 0);

  // A stated 10.5 h day: the weighted lines share what the pins leave, and the extra is overtime beyond the floor.
  const long = allocateDay(
    [
      { ticket: "T-1", weight: 1 },
      { ticket: "T-2", hours: 2.5 },
    ],
    8,
    10.5,
  );
  assert.deepEqual(long.hours, [8, 2.5]);
  assert.equal(long.length, 10.5);
  assert.equal(long.overtime, 2.5);
  assert.equal(long.inferred_length, false);

  // A stated day shorter than the floor does not shrink it: the floor is a minimum.
  assert.equal(allocateDay([{ ticket: "T-1", weight: 3 }], 8, 6).total, 8);

  // Pins alone short of the day: reported as a shortfall, never invented.
  const short = allocateDay([{ ticket: "T-1", hours: 5 }], 8);
  assert.equal(short.total, 5);
  assert.equal(short.shortfall, 3);

  // Pins fill the day with no stated length: flexible lines get one step each and the length is flagged.
  const full = allocateDay(
    [
      { ticket: "T-1", hours: 9 },
      { ticket: "T-2", weight: 3 },
    ],
    8,
  );
  assert.deepEqual(full.hours, [9, 0.25]);
  assert.equal(full.inferred_length, true);
  assert.equal(full.overtime, 1.25);

  // Internal is on top of the floor: a weight is that many quarter hours, pins stand.
  const internal = allocateDay(
    [
      { ticket: "T-1", weight: 3 },
      { ticket: "Internal", weight: 2 },
      { ticket: "Internal", hours: 1 },
    ],
    8,
  );
  assert.deepEqual(internal.hours, [8, 0.5, 1]);
  assert.equal(internal.billable, 8);
  assert.equal(internal.internal, 1.5);
  assert.equal(internal.total, 9.5);
  assert.equal(internal.overtime, 0);

  // Nothing logged is zero, not a manufactured eight.
  assert.equal(allocateDay([], 8).total, 0);

  // Quarter hours that sum exactly.
  const odd = allocateDay(
    [
      { ticket: "a", weight: 1 },
      { ticket: "b", weight: 1 },
      { ticket: "c", weight: 1 },
    ],
    7.5,
  );
  assert.equal(
    odd.hours.reduce((s, h) => s + h, 0),
    7.5,
  );
  for (const h of odd.hours) assert.equal(h * 4, Math.round(h * 4));
});

test("log-work writes an id and a source; log edit changes one line with dry run and a stale-hash check", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const one = await ws.run("log-work", { ticket: "T-014-sa", text: "Wrote the format map", date: DATE, source: "agent-run:r-123" });
    assert.ok(one.ok, JSON.stringify(one));
    await ws.run("log-work", { ticket: "T-015-sa", text: "Reviewed the record schemas", date: DATE, weight: 1 });
    const bad = await ws.run("log-work", { ticket: "-", text: "Did a thing", date: DATE, source: "telepathy" });
    assert.equal(bad.ok, false);

    const wl = ws.runtime.ctx.get("worklog") as WorkLogFull;
    const sheet = await wl.sheet(DATE, "sam");
    assert.ok(sheet);
    const [first] = sheet.entries;
    assert.match(first!.id, /^e[0-9a-f]{6}$/);
    assert.equal(first!.source, "agent-run:r-123");
    assert.equal(sheet.total, 8);

    // Dry run: nothing changes on disk.
    const before = readFileSync(join(ws.root, FILE), "utf8");
    const dry = await ws.run("log edit", { date: DATE, entry: first!.id, hours: "2" }, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.equal(readFileSync(join(ws.root, FILE), "utf8"), before);

    // Pin by id, then edit by position.
    const pin = await ws.run("log edit", { date: DATE, entry: first!.id, hours: "2", hash: sheet.hash });
    assert.ok(pin.ok, JSON.stringify(pin));
    const text = await ws.run("log edit", { date: DATE, entry: "2", text: "Reviewed the record schemas and the emitters", category: "code review" });
    assert.ok(text.ok, JSON.stringify(text));
    const after = await wl.sheet(DATE, "sam");
    assert.equal(after?.entries[0]?.hours, 2);
    assert.equal(after?.entries[0]?.hours_alloc, 2);
    assert.equal(after?.entries[1]?.category, "Code Review");
    assert.equal(after?.entries[1]?.hours_alloc, 6);
    assert.match(after?.entries[1]?.id ?? "", /^e[0-9a-f]{6}$/);

    // A weight unpins the line.
    await ws.run("log edit", { date: DATE, entry: first!.id, weight: "3" });
    assert.equal((await wl.sheet(DATE, "sam"))?.entries[0]?.pinned, false);

    // The old hash is stale now.
    const stale = await ws.run("log edit", { date: DATE, entry: first!.id, text: "Wrote the map", hash: sheet.hash });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.rule, "stale-write");

    // The same text rules as log-work.
    const banned = await ws.run("log edit", { date: DATE, entry: first!.id, text: "The builder agent wrote it" });
    assert.equal(banned.ok, false);
    if (!banned.ok) assert.equal(banned.error.rule, "worklog-text");
    const missing = await ws.run("log edit", { date: DATE, entry: "e000000", text: "Wrote it" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.rule, "worklog-entry");
    const nothing = await ws.run("log edit", { date: DATE, entry: "1" });
    assert.equal(nothing.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("log remove and log day-hours: dry run, stale hash, and the stated length drives overtime", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    await ws.run("log-work", { ticket: "T-014-sa", text: "Wrote the format map", date: DATE });
    await ws.run("log-work", { ticket: "T-015-sa", text: "Reviewed the record schemas", date: DATE });
    const wl = ws.runtime.ctx.get("worklog") as WorkLogFull;
    const s0 = await wl.sheet(DATE, "sam");
    assert.ok(s0);

    const dry = await ws.run("log remove", { date: DATE, entry: s0.entries[1]!.id }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal((await wl.sheet(DATE, "sam"))?.entries.length, 2);
    const rm = await ws.run("log remove", { date: DATE, entry: s0.entries[1]!.id, hash: s0.hash });
    assert.ok(rm.ok, JSON.stringify(rm));
    assert.equal((await wl.sheet(DATE, "sam"))?.entries.length, 1);
    const again = await ws.run("log remove", { date: DATE, entry: "1", hash: s0.hash });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.error.rule, "stale-write");

    const dh = await ws.run("log day-hours", { date: DATE, hours: "10.4" });
    assert.ok(dh.ok, JSON.stringify(dh));
    const s1 = await wl.sheet(DATE, "sam");
    assert.equal(s1?.day_hours, 10.5);
    assert.equal(s1?.total, 10.5);
    assert.equal(s1?.overtime, 2.5);
    const day = parse(readFileSync(join(ws.root, FILE), "utf8")) as { day: { day_hours?: number } };
    assert.equal(day.day.day_hours, 10.5);

    const dryClear = await ws.run("log day-hours", { date: DATE, hours: "0" }, { dryRun: true });
    assert.ok(dryClear.ok);
    assert.equal((await wl.sheet(DATE, "sam"))?.day_hours, 10.5);
    const clear = await ws.run("log day-hours", { date: DATE, hours: "0", hash: s1?.hash });
    assert.ok(clear.ok, JSON.stringify(clear));
    assert.equal((await wl.sheet(DATE, "sam"))?.day_hours, undefined);
    const tooLong = await ws.run("log day-hours", { date: DATE, hours: "25" });
    assert.equal(tooLong.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("quick picks and categories come from the plugin config", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    writeFileSync(
      join(ws.root, "workspace.toml"),
      `${readFileSync(join(ws.root, "workspace.toml"), "utf8")}\n[[plugin]]\nid = "work-log"\nuse = "work-log"\nconfig = { categories = ["Testing", "development"], quick_picks = ["Standup|Internal|Internal|0.25", { label = "Leave", ticket = "Leave", category = "Internal", hours = 8 }] }\n`,
    );
    await ws.runtime.dispose();
    const { createRuntime } = await import("@helmlock/core");
    const rt = await createRuntime({ cwd: ws.root, env: { HL_DELIVERY: ws.runtime.info.deliveryRoot }, catalog });
    try {
      await rt.mountAll();
      const s = (rt.ctx.get("worklog") as WorkLogFull).settings();
      assert.deepEqual(s.categories, ["Testing", "Development"]);
      assert.deepEqual(s.quick_picks, [
        { label: "Standup", ticket: "Internal", category: "Internal", hours: 0.25 },
        { label: "Leave", ticket: "Leave", category: "Internal", hours: 8 },
      ]);
      const refused = await rt.run("log-work", { ticket: "-", text: "Drew the screens", category: "Design", date: DATE });
      assert.equal(refused.ok, false);
    } finally {
      await rt.dispose();
    }
  } finally {
    await ws.cleanup().catch(() => {});
  }
});

test("search: terms are ANDed, field:value narrows, -term excludes", () => {
  const row = { ticket: "T-014-sa", category: "Testing", text: "Placed UAT orders", source: "agent-run:r1", author: "sam", date: DATE };
  const q = (s: string) => matches(parseQuery(s), row);
  assert.equal(q("uat"), true);
  assert.equal(q("uat orders"), true);
  assert.equal(q("uat invoices"), false);
  assert.equal(q("ticket:t-014"), true);
  assert.equal(q("ticket:uat"), false);
  assert.equal(q("cat:testing who:sam"), true);
  assert.equal(q("date:2026-10"), true);
  assert.equal(q("src:agent-run"), true);
  assert.equal(q("-cat:testing"), false);
  assert.equal(q("uat -invoice"), true);
  assert.equal(q("nofield:uat"), false);
  assert.deepEqual(parseQuery("-who:sam"), [{ field: "author", value: "sam", negated: true }]);
});

test("search, sheets and range rollups through the service", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    await ws.run("log-work", { ticket: "T-014-sa", text: "Placed UAT orders", date: "2026-10-05", category: "Testing" });
    await ws.run("log-work", { ticket: "T-015-sa", text: "Wrote the reader", date: DATE });
    await ws.run("log-work", { ticket: "Internal", text: "Daily scrum", date: DATE, hours: 0.5 });
    const wl = ws.runtime.ctx.get("worklog") as WorkLogFull;
    const hits = await wl.search("cat:testing");
    assert.equal(hits.total, 1);
    assert.equal(hits.hits[0]?.date, "2026-10-05");
    assert.equal((await wl.search("-ticket:Internal")).total, 2);

    const sheets = await wl.sheets("2026-10-05", "2026-10-11");
    const r = rangeOf(sheets, "2026-10-05", "2026-10-11", null);
    assert.equal(r.total, 16.5);
    assert.equal(r.days_logged, 2);
    assert.equal(r.span_days, 3);
    assert.equal(r.by_day.length, 7);
    assert.equal(r.by_day.find((d) => d.key === "2026-10-06")?.hours, 0);
    assert.deepEqual(
      r.cells.filter((c) => c.date === DATE).map((c) => [c.ticket, c.hours]),
      [
        ["Internal", 0.5],
        ["T-015-sa", 8],
      ],
    );
    const sheet = sheets.find((s) => s.date === DATE);
    assert.deepEqual(
      sheet?.tickets.map((t) => [t.ticket, t.hours, t.pinned]),
      [
        ["T-015-sa", 8, false],
        ["Internal", 0.5, true],
      ],
    );
    assert.deepEqual(await wl.authors(), ["sam"]);
  } finally {
    await ws.cleanup();
  }
});

test("sheetOf addresses lines written before ids by position", () => {
  const s = sheetOf(
    {
      schema_version: 1,
      day: { date: DATE, author: "sam" },
      entry: [{ ticket: "T-1", category: "Development", text: "Old line", weight: 3, logged: `${DATE}T09:00:00` }],
    },
    { file: FILE, hash: "h", name: "Sam", floor: 8 },
  );
  assert.equal(s.entries[0]?.id, "#1");
});

test("evidence: first and last commit by a matched git name, runs, and a clamped suggestion", () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-ev-"));
  try {
    const git = (args: string[], env: Record<string, string> = {}) =>
      assert.equal(spawnSync("git", args, { cwd: dir, env: { ...process.env, ...env }, windowsHide: true }).status, 0, args.join(" "));
    git(["init", "-q"]);
    const commit = (name: string, at: string, file: string) => {
      writeFileSync(join(dir, file), at);
      git(["add", file]);
      git(["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", file], {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: `${name.replace(/\s/g, "").toLowerCase()}@example.org`,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: "x@example.org",
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_DATE: at,
      });
    };
    commit("Sam A", `${DATE}T09:10:00+05:30`, "a.txt");
    commit("Someone Else", `${DATE}T07:00:00+05:30`, "b.txt");
    commit("Sam A", `${DATE}T19:40:00+05:30`, "c.txt");
    commit("Sam A", "2026-10-06T23:00:00+05:30", "d.txt");

    const commits = scanGit([{ name: "repo", abs: dir }], DATE, ["sam a"]);
    assert.deepEqual(
      commits.map((c) => c.at),
      [`${DATE}T09:10:00`, `${DATE}T19:40:00`],
    );
    assert.equal(commits[0]?.files, 1);

    const ev = evidenceFor({ date: DATE, author: "sam", commits, runs: [{ id: "r1", start: `${DATE}T20:00:00`, end: `${DATE}T21:05:00` }], floor: 8 });
    assert.equal(ev.first, "09:10");
    assert.equal(ev.last, "21:05");
    assert.equal(ev.commits, 2);
    assert.equal(ev.runs, 1);
    assert.equal(ev.suggested, 12);
    assert.equal(ev.worth_asking, true);
    assert.ok(ev.reasons.some((r) => r.includes("2 commits")));

    // Declared already: nothing worth asking. A short span keeps the floor; a huge one is capped at 16.
    assert.equal(evidenceFor({ date: DATE, author: "sam", commits, runs: [], floor: 8, declared: 9 }).worth_asking, false);
    assert.equal(suggestLength(3, 8), 8);
    assert.equal(suggestLength(20, 8), 16);
    assert.equal(suggestLength(undefined, 8), undefined);
    const none = evidenceFor({ date: DATE, author: "sam", commits: [], runs: [], floor: 8 });
    assert.equal(none.suggested, undefined);
    assert.equal(scanGit([{ name: "repo", abs: dir }], DATE, []).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("suggestions: finished runs and ticket moves of the person with no log line yet", () => {
  const local = (hhmm: string) => new Date(`${DATE}T${hhmm}:00`).toISOString();
  const entries: WorkLogEntry[] = [
    { ticket: "T-9", category: "Development", text: "Logged", weight: 3, logged: `${DATE}T10:00:00`, source: "agent-run:r-logged" },
  ];
  const activity: ActivityLine[] = [
    { ts: local("11:00"), actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "ticket move", entity: "T-2", code: 0 },
    { ts: local("11:05"), actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "ticket move", entity: "T-9", code: 0 },
    { ts: local("11:10"), actor: { kind: "person", id: "ann" }, on_behalf_of: "ann", verb: "ticket move", entity: "T-3", code: 0 },
    { ts: local("11:15"), actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "ticket move", entity: "T-4", code: 2 },
  ];
  const items = suggestionsFor({
    date: DATE,
    author: "sam",
    entries,
    activity,
    titles: { "T-2": "CSV export" },
    runs: [
      {
        id: "r-1",
        ticket: "T-1",
        role: "builder",
        started: local("09:00"),
        ended: local("09:30"),
        responsible: "sam",
        outcome: { outcome: "done", summary: "Built the CSV reader: tests pass. Next is the writer." },
      },
      { id: "r-old", started: local("08:00"), ended: local("08:10"), responsible: "sam", first_result_line: "Fixed the parser" },
      { id: "r-logged", started: local("09:00"), ended: local("09:10"), responsible: "sam" },
      { id: "r-live", started: local("09:00"), status: "running", responsible: "sam" },
      { id: "r-ann", started: local("09:00"), ended: local("09:10"), responsible: "ann" },
      { id: "r-yday", started: "2026-10-06T09:00:00", ended: "2026-10-06T09:10:00", responsible: "sam" },
    ],
  });
  assert.deepEqual(
    items.map((i) => i.key),
    ["move:T-2", "run:r-1", "run:r-old"],
  );
  const run = items.find((i) => i.key === "run:r-1");
  assert.equal(run?.text, "Built the CSV reader, tests pass");
  assert.equal(run?.source, "agent-run:r-1");
  assert.equal(run?.ticket, "T-1");
  assert.equal(items.find((i) => i.key === "run:r-old")?.text, "Fixed the parser");
  assert.equal(items.find((i) => i.key === "move:T-2")?.text, "Worked on CSV export");
  assert.equal(draftSentence("It’s done — shipped; #1"), "Its done shipped, 1");
  assert.ok(draftSentence("x ".repeat(200)).length <= 160);
});
