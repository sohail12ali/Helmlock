// `hl run report` (F154): run id from HL_RUN_ID, posted to the server from a server-started run, filed for the run's
// end otherwise; the comment text; the brief instruction.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { VerbCtx } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { createRunReportVerb, outcomeComment, REPORT_INSTRUCTION, REPORT_PATH, RunReportInput } from "./run-report.ts";

let ws: TestWorkspace;
before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  await ws.runtime.mountAll();
});
after(async () => {
  await ws.cleanup();
});

const vctx = (dryRun = false): VerbCtx => ({
  ctx: ws.runtime.ctx,
  actor: { kind: "person", id: "sam", onBehalfOf: "sam" },
  dryRun,
  json: false,
  cwd: ws.root,
  interactive: false,
});
const input = (o: Record<string, unknown>) => RunReportInput.parse({ outcome: "done", summary: "Built it", ...o });

test("the comment reads like a crew member speaking", () => {
  assert.equal(outcomeComment("builder", { outcome: "done", summary: "Slice 1 built" }), "Builder: [done] Slice 1 built.");
  assert.equal(outcomeComment(undefined, { outcome: "blocked", summary: "No access.", next: "grant access" }), "[blocked] No access. Next: grant access");
  assert.match(REPORT_INSTRUCTION, /hl run report --outcome done\|review\|blocked\|needs-input --summary/);
});

test("no HL_RUN_ID: a clear error; bad outcome is refused by the input schema", async () => {
  const verb = createRunReportVerb({ env: {} });
  const res = await verb.run(vctx(), input({}));
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.error.rule, "no-run");
  assert.equal(RunReportInput.safeParse({ outcome: "finished", summary: "x" }).success, false);
});

test("inside a server-started run: posts to the internal endpoint with the hook token", async () => {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const verb = createRunReportVerb({
    env: { HL_RUN_ID: "run-1", HL_SERVER_URL: "http://127.0.0.1:9", HL_HOOK_TOKEN: "tok", HL_ROLE: "builder" },
    fetch: fakeFetch,
  });
  const dry = await verb.run(vctx(true), input({}));
  assert.equal(dry.ok, true);
  assert.equal(calls.length, 0, "a dry run posts nothing");
  const res = await verb.run(vctx(), input({ next: "verify", next_role: "verifier" }));
  assert.equal(res.ok, true);
  assert.equal(calls[0]?.url, `http://127.0.0.1:9${REPORT_PATH}`);
  assert.equal(calls[0]?.headers["X-Helmlock-Hook-Token"], "tok");
  assert.deepEqual(calls[0]?.body, { run_id: "run-1", by: "builder", outcome: "done", summary: "Built it", next: "verify", next_role: "verifier" });
});

test("no server channel: the report is filed in runs/reports/<id>.json for the run's end", async () => {
  const verb = createRunReportVerb({ env: { HL_RUN_ID: "run-77" } });
  const res = await verb.run(vctx(), input({ outcome: "review" }));
  assert.equal(res.ok, true);
  const f = join(ws.root, "runs", "reports", "run-77.json");
  assert.ok(existsSync(f));
  assert.equal((JSON.parse(readFileSync(f, "utf8")) as { outcome: { outcome: string } }).outcome.outcome, "review");
});
