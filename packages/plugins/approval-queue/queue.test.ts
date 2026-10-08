import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Actor } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { type ApprovalLogRow, createApprovalQueue } from "./queue.ts";

const actor: Actor = { kind: "agent", id: "builder", onBehalfOf: "sam" };
const req = (o: Partial<Parameters<ReturnType<typeof createApprovalQueue>["request"]>[0]> = {}) => ({
  action: "shell",
  detail: "git status",
  tool: "Bash",
  actor,
  run_id: "run-1",
  local_only: false,
  ...o,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(timeoutMs = 5000) {
  const events: { name: string; payload: unknown }[] = [];
  const rows: ApprovalLogRow[] = [];
  const q = createApprovalQueue({
    timeoutMs,
    emit: (name, payload) => void events.push({ name, payload }),
    log: (row) => void rows.push(row),
  });
  return { q, events, rows };
}

test("a card nobody answers is denied after the timeout (fail-closed)", async () => {
  const { q, events } = harness(30);
  const card = await q.request(req());
  assert.equal(card.status, "expired");
  assert.equal(card.decided_via, "timeout");
  assert.deepEqual(q.pending(), []);
  assert.equal(q.recent()[0]?.id, card.id);
  assert.deepEqual(
    events.map((e) => e.name),
    ["approval.requested", "approval.decided"],
  );
  assert.equal((events[1] as { payload: { decision: string } }).payload.decision, "deny");
});

test("allow once: the card is allowed, the next identical call asks again", async () => {
  const { q, events, rows } = harness();
  const p = q.request(req());
  await tick();
  const [pending] = q.pending();
  assert.ok(pending);
  assert.equal(pending.status, "pending");
  const answered = q.answer(pending.id, "allow", "sam", "console");
  assert.equal(answered.status, "allowed");
  assert.equal((await p).status, "allowed");
  assert.equal((await p).decided_by, "sam");
  const again = q.request(req());
  await tick();
  assert.equal(q.pending().length, 1, "once means once");
  q.answer(q.pending()[0]?.id as string, "deny", "sam", "console");
  assert.equal((await again).status, "denied");
  assert.deepEqual(
    rows.map((r) => r.event),
    ["requested", "decided", "requested", "decided"],
  );
  assert.ok(
    rows.every((r) => r.responsible === "sam"),
    "every log line names the responsible person (Blueprint 31)",
  );
  const decided = events.filter((e) => e.name === "approval.decided").map((e) => (e.payload as { decision: string; channel: string }).decision);
  assert.deepEqual(decided, ["allow", "deny"]);
  assert.throws(() => q.answer(pending.id, "deny", "sam", "console"), { rule: "already-decided" } as object);
  assert.throws(() => q.answer("ap-nope", "deny", "sam", "console"), { rule: "unknown-approval" } as object);
});

test("allow for this chat: the same tool in the same run is allowed without a card; another run still asks", async () => {
  const { q } = harness();
  const p = q.request(req());
  await tick();
  q.answer(q.pending()[0]?.id as string, "allow", "sam", "console", "chat");
  assert.equal((await p).scope, "chat");
  const second = await q.request(req({ detail: "git log" }));
  assert.equal(second.status, "allowed");
  assert.equal(second.scope, "chat");
  assert.deepEqual(q.pending(), []);
  const other = q.request(req({ run_id: "run-2" }));
  const edit = q.request(req({ tool: "Edit", action: "edit file" }));
  await tick();
  assert.equal(q.pending().length, 2);
  q.expireRun("run-2");
  q.expireRun("run-1");
  assert.equal((await other).status, "expired");
  assert.equal((await edit).status, "expired");
  // The run ended: its allowance is gone too.
  const later = q.request(req(), { timeoutMs: 20 });
  assert.equal((await later).status, "expired");
});

test("a local-only card cannot be answered from Telegram and never gets 'allow for this chat'", async () => {
  const { q } = harness();
  const p = q.request(req({ action: "clipboard", tool: undefined, detail: "read the clipboard" }));
  await tick();
  const card = q.pending()[0];
  assert.ok(card?.local_only, "clipboard is local-only by action name");
  assert.throws(() => q.answer(card.id, "allow", "sam", "telegram"), { rule: "local-only" } as object);
  assert.equal(q.pending().length, 1, "still pending after the refused answer");
  q.answer(card.id, "allow", "sam", "console", "chat");
  const done = await p;
  assert.equal(done.status, "allowed");
  assert.equal(done.scope, "once");
  const next = q.request(req({ action: "clipboard", tool: undefined }), { timeoutMs: 20 });
  assert.equal((await next).status, "expired", "asked again");
});

test("plugin: the approval/request hook asks the queue only once a console is attached; cards are logged", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    await ws.runtime.mountAll();
    const ctx = ws.runtime.ctx;
    const queue = ctx.get("approvalQueue") as ReturnType<typeof createApprovalQueue>;
    const approvals = ctx.get("approvals");
    const person: Actor = { kind: "person", id: "sam", onBehalfOf: "sam" };
    const offline = await approvals.decide({ action: "git push", detail: "origin main", actor: person });
    assert.equal(offline.decision, "deny", "no console: fail-closed like before");
    assert.deepEqual(queue.pending(), []);

    queue.enableRemote();
    const asked = approvals.decide({ action: "git push", detail: "origin main", actor: person });
    await new Promise((r) => setTimeout(r, 20));
    const card = queue.pending()[0];
    assert.equal(card?.action, "git push");
    queue.answer(card?.id as string, "allow", "sam", "console");
    assert.equal((await asked).decision, "allow");

    const day = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const file = join(ws.root, "approvals", `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.jsonl`);
    const lines = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : []);
    const t0 = Date.now();
    while (lines().length < 2 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(
      lines().map((l) => (JSON.parse(l) as { event: string }).event),
      ["requested", "decided"],
    );
    assert.equal(readFileSync(join(ws.root, "approvals", ".gitignore"), "utf8"), "*\n");
  } finally {
    await ws.cleanup();
  }
});
