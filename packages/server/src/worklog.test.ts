import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { WorkConfigView, WorkDayView, WorkEvidence, WorkRangeView, WorkSearchResult, WorkSuggestions } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { createApp } from "./app.ts";

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };
const DATE = "2026-10-07";

test("Work page reads: config, day sheets, edits through verbs, range, search, evidence and suggestions", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    writeFileSync(
      join(ws.root, "people.toml"),
      'schema_version = 1\n\n[[person]]\nid = "sam"\nname = "Sam Abbott"\ninitials = "sa"\nemail = "sam@example.com"\ngit = ["Sam A"]\n',
    );
    const app = createApp(ws.runtime, { log: () => {} });
    const get = async <T>(path: string): Promise<T> => {
      const res = await app.request(`/api/v1${path}`);
      const body = (await res.json()) as { ok: boolean; data: T; error?: unknown };
      assert.equal(res.status, 200, JSON.stringify(body));
      return body.data;
    };
    const post = (verb: string, input: Record<string, unknown>) =>
      app.request(`/api/v1/verbs/${verb}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ input }) });

    assert.equal((await post("log-work", { ticket: "T-001-sa", text: "Wrote the reader", date: DATE, source: "agent-run:r-1" })).status, 200);
    assert.equal((await post("log-work", { ticket: "Internal", text: "Daily scrum", date: DATE, hours: 0.5 })).status, 200);

    const cfg = await get<WorkConfigView>("/worklog/config");
    assert.equal(cfg.floor, 8);
    assert.equal(cfg.categories.length, 6);
    assert.deepEqual(cfg.me, { id: "sam", name: "Sam Abbott" });
    assert.deepEqual(cfg.authors, [{ id: "sam", name: "Sam Abbott" }]);

    const day = await get<WorkDayView>(`/worklog/day?date=${DATE}`);
    assert.equal(day.sheets.length, 1);
    const sheet = day.sheets[0]!;
    assert.equal(sheet.name, "Sam Abbott");
    assert.equal(sheet.total, 8.5);
    assert.equal(sheet.internal, 0.5);

    // Edit and day length through the console verbs, with the hash the page read.
    const edit = await post("log/edit", { date: DATE, entry: sheet.entries[0]!.id, text: "Wrote the reader and its tests", hash: sheet.hash });
    assert.equal(edit.status, 200, await edit.clone().text());
    const stale = await post("log/day-hours", { date: DATE, hours: 10, hash: sheet.hash });
    assert.equal(stale.status, 409, await stale.clone().text());
    const fresh = (await get<WorkDayView>(`/worklog/day?date=${DATE}&author=me`)).sheets[0]!;
    assert.equal((await post("log/day-hours", { date: DATE, hours: 10, hash: fresh.hash })).status, 200);
    const after = (await get<WorkDayView>(`/worklog/day?date=${DATE}`)).sheets[0]!;
    assert.equal(after.day_hours, 10);
    assert.equal(after.overtime, 2);
    assert.equal(after.entries[0]!.text, "Wrote the reader and its tests");

    const range = await get<WorkRangeView>("/worklog/range?start=2026-10-05&end=2026-10-11");
    assert.equal(range.total, 10.5);
    assert.equal(range.days_logged, 1);
    assert.equal(range.by_day.length, 7);
    assert.deepEqual(range.by_author, [{ key: "sam", hours: 10.5 }]);
    const bad = await app.request("/api/v1/worklog/range?start=2026-10-12&end=2026-10-11");
    assert.equal(bad.status, 400);

    const found = await get<WorkSearchResult>(`/worklog/search?q=${encodeURIComponent("src:agent-run -ticket:Internal")}`);
    assert.equal(found.total, 1);
    assert.equal(found.hits[0]!.ticket, "T-001-sa");

    // Evidence: commits by the person's git spelling in the workspace repo, plus their runs.
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Sam A",
      GIT_AUTHOR_EMAIL: "s@example.org",
      GIT_COMMITTER_NAME: "Sam A",
      GIT_COMMITTER_EMAIL: "s@example.org",
    };
    const git = (args: string[], extra: Record<string, string> = {}) =>
      assert.equal(spawnSync("git", args, { cwd: ws.root, env: { ...env, ...extra }, windowsHide: true }).status, 0);
    git(["init", "-q"]);
    for (const [f, at] of [
      ["a.txt", `${DATE}T08:30:00+05:30`],
      ["b.txt", `${DATE}T19:00:00+05:30`],
    ] as const) {
      writeFileSync(join(ws.root, f), f);
      git(["add", f]);
      git(["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", f], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
    }
    const ev = await get<WorkEvidence>(`/worklog/evidence?date=${DATE}`);
    assert.equal(ev.commits, 2);
    assert.equal(ev.first, "08:30");
    assert.equal(ev.last, "19:00");
    assert.equal(ev.suggested, 10.5);
    assert.equal(ev.declared, 10);
    assert.equal(ev.worth_asking, false);

    // Suggestions: a finished run of mine with no line yet (r-1 is already logged).
    mkdirSync(join(ws.root, "runs"), { recursive: true });
    const t = (hhmm: string) => new Date(`${DATE}T${hhmm}:00`).toISOString();
    for (const [id, summary] of [
      ["r-1", "Already logged."],
      ["r-2", "Wrote the CSV writer. Tests pass."],
    ] as const) {
      writeFileSync(
        join(ws.root, "runs", `${id}.json`),
        JSON.stringify({
          id,
          ticket: "T-001-sa",
          runtime: "claude",
          mode: "plan",
          started: t("10:00"),
          ended: t("10:20"),
          ok: true,
          responsible: "sam",
          outcome: { outcome: "done", summary },
        }),
      );
    }
    const sug = await get<WorkSuggestions>(`/worklog/suggestions?date=${DATE}`);
    assert.deepEqual(
      sug.items.map((i) => [i.key, i.text, i.source]),
      [["run:r-2", "Wrote the CSV writer", "agent-run:r-2"]],
    );
  } finally {
    await ws.cleanup();
  }
});
