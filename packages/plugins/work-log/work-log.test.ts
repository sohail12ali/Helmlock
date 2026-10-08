import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace, FIXTURES } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";
import { weekOf } from "./index.ts";
import { allocate, cleanText, similarity } from "./rules.ts";

const DATE = "2026-10-07";
const FILE = `logs/2026-10/${DATE}.sam.toml`;

test("log-work writes the day file with author, category and weight defaults", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const res = await ws.run("log-work", { ticket: "T-014-sa", text: "Chose TOML for records and wrote the format map", date: DATE });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal((res.data as { written: boolean; file: string }).written, true);
    assert.equal((res.data as { file: string }).file, FILE);
    const day = parse(readFileSync(join(ws.root, FILE), "utf8")) as { schema_version: number; day: Record<string, unknown>; entry: Record<string, unknown>[] };
    assert.equal(day.schema_version, 1);
    assert.equal(day.day.date, DATE);
    assert.equal(day.day.author, "sam");
    assert.equal(day.entry.length, 1);
    assert.equal(day.entry[0]?.ticket, "T-014-sa");
    assert.equal(day.entry[0]?.category, "Development");
    assert.equal(day.entry[0]?.weight, 3);
    assert.equal(day.entry[0]?.hours, undefined);
    assert.equal(typeof day.entry[0]?.logged, "string");

    const pinned = await ws.run("log-work", { ticket: "Internal", text: "Daily scrum", hours: "0.5", category: "internal", date: DATE });
    assert.ok(pinned.ok, JSON.stringify(pinned));
    const back = await ws.runtime.ctx.get("worklog").day(DATE, "sam");
    assert.equal(back?.entry.length, 2);
    assert.equal(back?.entry[1]?.category, "Internal");
    assert.equal(back?.entry[1]?.hours, 0.5);

    const dry = await ws.run("log-work", { ticket: "-", text: "Reviewed the release checklist", date: DATE }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal((await ws.runtime.ctx.get("worklog").day(DATE, "sam"))?.entry.length, 2);
  } finally {
    await ws.cleanup();
  }
});

test("a near-duplicate entry on the same day and ticket is skipped", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const first = await ws.run("log-work", { ticket: "T-014-sa", text: "Wrote the format map for records and logs", date: DATE });
    assert.ok(first.ok);
    const again = await ws.run("log-work", { ticket: "T-014-sa", text: "Wrote the format map for the records and logs", date: DATE });
    assert.ok(again.ok);
    assert.equal((again.data as { written: boolean }).written, false);
    assert.equal((again.data as { reason: string }).reason, "duplicate");
    // Same words on another ticket are not a duplicate; unrelated text on the same ticket is not either.
    const other = await ws.run("log-work", { ticket: "T-015-sa", text: "Wrote the format map for records and logs", date: DATE });
    assert.equal((other as { data: { written: boolean } }).data.written, true);
    const different = await ws.run("log-work", { ticket: "T-014-sa", text: "Fixed the stale write check in the file layer", date: DATE });
    assert.equal((different as { data: { written: boolean } }).data.written, true);
    assert.equal((await ws.runtime.ctx.get("worklog").day(DATE, "sam"))?.entry.length, 3);
  } finally {
    await ws.cleanup();
  }
});

test("similarity is about 70% for near duplicates and low for different work", () => {
  assert.ok(similarity("Wrote the format map", "wrote the format map.") >= 0.7);
  assert.ok(similarity("Fixed login bug and added tests", "Added tests and fixed login bug") >= 0.7);
  assert.ok(similarity("Daily scrum", "Estimation meeting for the WMS release") < 0.7);
});

test("agent and skill names and banned symbols are rejected", async () => {
  for (const bad of [
    "The builder agent shipped slice one",
    "Ran the spec skill on the ticket",
    "Claude wrote the plan",
    "Verifier checked the acceptance criteria",
    "Shipped slice one: the API",
    "Shipped the API; wrote tests",
    "Fixed the user’s login",
    "x".repeat(161),
  ]) {
    assert.throws(
      () => cleanText(bad),
      (e: Error & { rule?: string }) => e.rule === "worklog-text",
      bad,
    );
  }
  assert.equal(cleanText("  Shipped   the rolled-back skip proof  "), "Shipped the rolled-back skip proof");

  const ws = await createTestWorkspace({ catalog });
  try {
    const res = await ws.run("log-work", { ticket: "T-014-sa", text: "The planner broke the ticket into slices", date: DATE });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error.rule, "worklog-text");
    assert.equal(existsSync(join(ws.root, FILE)), false);
    const cat = await ws.run("log-work", { ticket: "-", text: "Wrote docs", category: "Lunch", date: DATE });
    assert.equal(cat.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("allocation keeps pinned hours and sums exactly to the day in quarter hours", () => {
  const entries = [{ weight: 3 }, { hours: 0.5 }, { weight: 2 }, { weight: 1 }, { weight: 5 }];
  const a = allocate(entries, 8);
  assert.equal(a.total, 8);
  assert.equal(a.hours[1], 0.5);
  for (const h of a.hours) assert.equal(h * 4, Math.round(h * 4), `${h} is not a quarter hour`);
  assert.ok((a.hours[4] ?? 0) > (a.hours[0] ?? 0) && (a.hours[0] ?? 0) > (a.hours[3] ?? 0));

  // Thirds of 7.5 h do not split evenly; largest remainder still lands on the total.
  const b = allocate([{ weight: 1 }, { weight: 1 }, { weight: 1 }], 7.5);
  assert.equal(
    b.hours.reduce((s, h) => s + h, 0),
    7.5,
  );
  // Pinned hours beyond the day: the day grows, flexible entries get one step each and the length is flagged.
  const c = allocate([{ hours: 8 }, { weight: 3 }], 8);
  assert.deepEqual(c.hours, [8, 0.25]);
  assert.equal(c.inferred_length, true);
});

test("range allocates each day with the configured day_hours and reads lc-wms day files", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    writeFileSync(
      join(ws.root, "workspace.toml"),
      `${readFileSync(join(ws.root, "workspace.toml"), "utf8")}\n[[plugin]]\nid = "work-log"\nuse = "work-log"\nconfig = { day_hours = 6 }\n`,
    );
    await ws.runtime.dispose();
    const { createRuntime } = await import("@helmlock/core");
    const rt = await createRuntime({ cwd: ws.root, env: { HL_DELIVERY: ws.runtime.info.deliveryRoot }, catalog });
    try {
      await rt.run("log-work", { ticket: "T-014-sa", text: "Wrote the format map", weight: 3, date: DATE });
      await rt.run("log-work", { ticket: "Internal", text: "Daily scrum", hours: 0.5, date: DATE });
      await rt.run("log-work", { ticket: "T-015-sa", text: "Reviewed the record schemas", weight: 1, date: DATE });
      const rows = await rt.ctx.get("worklog").range(DATE, DATE, "sam");
      assert.equal(rows.length, 3);
      // Billable tickets share the 6 h floor; Internal is counted on top of it.
      assert.equal(
        rows.reduce((s, r) => s + r.hours_alloc, 0),
        6.5,
      );
      assert.equal(rows.find((r) => r.ticket === "Internal")?.hours_alloc, 0.5);

      mkdirSync(join(ws.root, "logs/2026-10"), { recursive: true });
      cpSync(join(FIXTURES, "s4-logs"), join(ws.root, "logs/2026-10"), { recursive: true });
      const legacy = await rt.ctx.get("worklog").range("2026-10-01", "2026-10-06");
      assert.deepEqual([...new Set(legacy.map((r) => r.author))].sort(), ["om-prakash", "sohail-ali"]);
      // 2026-10-02 has two Internal lines of weight 2 (0.5 h each, on top) and WLC-978 sharing the floor.
      for (const [d, h] of [
        ["2026-10-02", 7],
        ["2026-10-06", 6],
      ] as const) {
        assert.equal(
          legacy.filter((r) => r.date === d).reduce((s, r) => s + r.hours_alloc, 0),
          h,
        );
      }
      const day = await rt.ctx.get("worklog").day("2026-10-06", "sohail-ali");
      assert.equal(day?.day.date, "2026-10-06");
      assert.equal(day?.entry[0]?.category, "Testing");

      const show = await rt.run("log show", { week: true, date: DATE });
      assert.ok(show.ok);
      assert.deepEqual(weekOf(DATE), { from: "2026-10-05", to: "2026-10-11" });
      assert.equal((show.data as { total: number }).total, 6.5);
    } finally {
      await rt.dispose();
    }
  } finally {
    await ws.cleanup().catch(() => {});
  }
});
