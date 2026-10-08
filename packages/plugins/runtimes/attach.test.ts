import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { transcriptSummary } from "./attach.ts";
import { buildRecord, RunTally, stampResponsible } from "./run-record.ts";

const RUN = "run-20261007-142501-a1b2";

test("run attach copies the record and a transcript summary into the ticket and comments on it", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const record = stampResponsible(
      buildRecord(
        RUN,
        "claude-code",
        { prompt: "x", cwd: ws.root, addDirs: [], mode: "plan", silenceSec: 60, env: {}, ticket: "T-001-sa" },
        "2026-10-07T14:25:01.000Z",
        { ok: true, exitCode: 0, timedOut: false },
        new RunTally(),
      ),
      "sam",
    );
    assert.equal(record.responsible, "sam");
    assert.equal(record.credentials, "this machine");
    mkdirSync(join(ws.root, "runs"), { recursive: true });
    writeFileSync(join(ws.root, "runs", `${RUN}.json`), JSON.stringify(record, null, 2));
    const ev = (seq: number, event: unknown) => JSON.stringify({ seq, ts: "2026-10-07T14:25:02.000Z", event });
    writeFileSync(
      join(ws.root, "runs", `${RUN}.events.jsonl`),
      [
        ev(0, { type: "init", sessionId: "s1" }),
        ev(1, { type: "text", text: "Reading the spec.\n\nThe plan has two slices." }),
        ev(2, { type: "stderr", text: "token sk-secret leaked to stderr" }),
        ev(3, { type: "tool", phase: "start", name: "Read" }),
        ev(4, { type: "result", ok: true, text: "Done: plan written." }),
      ].join("\n"),
    );

    const dry = await ws.run("run attach", { run: RUN, ticket: "T-002-sa" }, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.equal(existsSync(join(ws.root, "artifacts/T-002-sa/runs", `${RUN}.md`)), false);

    const r = await ws.run("run attach", { run: RUN, ticket: "T-002-sa" });
    assert.ok(r.ok, JSON.stringify(r));
    const md = readFileSync(join(ws.root, "artifacts/T-002-sa/runs", `${RUN}.md`), "utf8");
    assert.match(md, /Reading the spec\.\nThe plan has two slices\.\nDone: plan written\./);
    assert.doesNotMatch(md, /sk-secret/);
    assert.match(md, /"responsible": "sam"/);
    assert.match(md, /Responsible: sam/);
    assert.match(md, /started for T-001-sa/);
    const comments = await ws.runtime.ctx.get("tickets").comments("T-002-sa");
    assert.equal(comments.at(-1)?.text, `Attached run ${RUN}`);

    const missing = await ws.run("run attach", { run: "run-nope", ticket: "T-002-sa" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.rule, "not-found");
    const noTicket = await ws.run("run attach", { run: RUN, ticket: "T-099-sa" });
    assert.equal(noTicket.ok, false);
  } finally {
    await ws.cleanup();
  }
});

test("transcript summary keeps the first lines of text and result events only", () => {
  const rows = Array.from({ length: 60 }, (_, i) => JSON.stringify({ seq: i, event: { type: "text", text: `line ${i}` } }));
  const s = transcriptSummary(["not json", ...rows].join("\n"), 50);
  assert.equal(s.lines.length, 50);
  assert.equal(s.cut, true);
  assert.equal(s.lines[0], "line 0");
});
