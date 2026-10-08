import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Context, Ticket } from "@helmlock/core";
import { createWorkflow, loadPack } from "./index.ts";

const ticket = (stage: string, extra: Partial<Ticket["ticket"]> = {}, blocked = false): Ticket => ({
  schema_version: 1,
  ticket: { id: "T-001-sa", title: "t", stage, priority: "normal", created: "", updated: "", ...extra },
  flags: blocked ? { blocked, blocked_by: "x", next_action: "y" } : { blocked },
  links: { related: [] },
  changes: [],
  dir: "artifacts/T-001-sa",
});

/** A context with just the services the gates read. */
function fakeCtx(s: { questions?: unknown[]; bugs?: unknown[]; tasks?: unknown[]; spec?: boolean } = {}): Context {
  const services: Record<string, unknown> = {
    records: { list: async (_t: string, kind: string) => (kind === "question" ? (s.questions ?? []) : (s.bugs ?? [])) },
    tasks: { list: async () => s.tasks ?? [] },
    files: { exists: async () => s.spec ?? false },
  };
  return { get: (k: string) => services[k] } as unknown as Context;
}

test("the pack has the six lanes in order with agents, wip and a terminal stage", () => {
  const pack = loadPack();
  assert.deepEqual(
    pack.stages.map((s) => s.id),
    ["backlog", "spec", "plan", "build", "verify", "done"],
  );
  assert.equal(pack.stages.find((s) => s.id === "build")?.wip, 6);
  assert.equal(pack.stages.find((s) => s.id === "verify")?.wip, 5);
  assert.equal(pack.stages.find((s) => s.id === "plan")?.agent, "planner");
  assert.equal(pack.stages.at(-1)?.terminal, true);
});

test("forward one step, back any step, any to backlog; never skip forward", async () => {
  const wf = createWorkflow(fakeCtx({ spec: true, tasks: [{ id: "S1-T1", status: "done" }] }), loadPack());
  assert.equal((await wf.check(ticket("backlog"), "spec")).allowed, true);
  assert.equal((await wf.check(ticket("verify"), "spec")).allowed, true);
  assert.equal((await wf.check(ticket("done"), "backlog")).allowed, true);
  assert.equal((await wf.check(ticket("spec"), "spec")).allowed, true);
  const skip = await wf.check(ticket("backlog"), "build");
  assert.equal(skip.allowed, false);
  assert.equal(skip.reasons[0]?.rule, "transition");
  assert.equal((await wf.check(ticket("backlog"), "zzz")).reasons[0]?.rule, "unknown-stage");
});

test("each gate blocks with its rule name and a fix", async () => {
  const pack = loadPack();
  const blocking = [{ id: "Q-001-sa", status: "open", blocking: true }];
  let r = await createWorkflow(fakeCtx({ questions: blocking, spec: true }), pack).check(ticket("spec"), "plan");
  assert.deepEqual(
    r.reasons.map((x) => x.rule),
    ["gate:no-blocking-questions"],
  );
  assert.ok(r.reasons[0]?.fix?.includes("Q-001-sa"));
  r = await createWorkflow(fakeCtx({ questions: [{ id: "Q-002-sa", status: "open", blocking: false }] }), pack).check(ticket("spec"), "plan");
  assert.deepEqual(
    r.reasons.map((x) => x.rule),
    ["gate:has-spec"],
  );
  r = await createWorkflow(fakeCtx(), pack).check(ticket("backlog", {}, true), "spec");
  assert.equal(r.reasons[0]?.rule, "gate:not-blocked");
  r = await createWorkflow(fakeCtx(), pack).check(ticket("plan", { size: "M" }), "build");
  assert.equal(r.reasons[0]?.rule, "gate:has-tasks");
  r = await createWorkflow(fakeCtx(), pack).check(ticket("plan", { size: "S" }), "build");
  assert.equal(r.allowed, true);
  r = await createWorkflow(fakeCtx({ tasks: [{ id: "S1-T1", status: "doing" }] }), pack).check(ticket("build"), "verify");
  assert.equal(r.reasons[0]?.rule, "gate:tasks-done");
  r = await createWorkflow(fakeCtx({ bugs: [{ id: "B-001-sa", status: "open" }] }), pack).check(ticket("verify"), "done");
  assert.equal(r.reasons[0]?.rule, "gate:no-open-bugs");
  r = await createWorkflow(fakeCtx({ bugs: [{ id: "B-001-sa", status: "fixed" }] }), pack).check(ticket("verify"), "done");
  assert.equal(r.allowed, true);
});

test("a pack naming an unknown gate or stage is refused at load", () => {
  const tmp = join(tmpdir(), `wf-${process.pid}.toml`);
  writeFileSync(tmp, '[[stage]]\nid = "a"\nlabel = "A"\n[[transition]]\nfrom = "a"\nto = "b"\ngate = []\n');
  assert.throws(() => loadPack(tmp), /unknown stage b/);
  writeFileSync(tmp, '[[stage]]\nid = "a"\nlabel = "A"\n[[transition]]\nfrom = "a"\nto = "a"\ngate = ["nope"]\n');
  assert.throws(() => loadPack(tmp), /unknown gate nope/);
});
