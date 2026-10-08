import assert from "node:assert/strict";
import { test } from "node:test";
import { createKernel } from "../kernel/kernel.ts";
import { createApprovals } from "./approvals.ts";

const actor = { kind: "agent" as const, id: "deployer", onBehalfOf: "sam" };
const req = { action: "git push", detail: "origin main", actor };

test("non-interactive asks are denied (fail-closed)", async () => {
  const k = createKernel({ log: () => {} });
  const a = createApprovals({ ctx: k.root, interactive: false, ask: async () => true });
  const r = await a.decide(req);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /not a terminal/);
});

test("interactive: yes allows, no denies, no answer denies", async () => {
  const k = createKernel({ log: () => {} });
  const answers: (boolean | undefined)[] = [true, false, undefined];
  const prompts: string[] = [];
  const a = createApprovals({
    ctx: k.root,
    interactive: true,
    timeoutMs: 10,
    ask: async (m, t) => {
      prompts.push(`${t}:${m}`);
      return answers.shift();
    },
  });
  assert.equal((await a.decide(req)).decision, "allow");
  assert.equal((await a.decide(req)).decision, "deny");
  const timedOut = await a.decide(req);
  assert.equal(timedOut.decision, "deny");
  assert.match(timedOut.reason, /no answer/);
  assert.match(prompts[0] ?? "", /^10:Allow deployer \(for sam\) to git push\?\norigin main$/);
});

test("a guard denies before a hook or the policy can allow", async () => {
  const k = createKernel({ log: () => {} });
  k.root.guard("approval/request", (p) => (p.action === "git push" ? "no pushes on Friday" : undefined));
  k.root.hook("approval/request", (p) => ({ ...p, decision: "allow" }));
  const a = createApprovals({ ctx: k.root, interactive: true, ask: async () => true, policy: { "git push": "act" } });
  assert.deepEqual(await a.decide(req), { decision: "deny", reason: "no pushes on Friday" });
});

test("a hook may decide; policy act allows without asking", async () => {
  const k = createKernel({ log: () => {} });
  const a = createApprovals({ ctx: k.root, policy: { shell: "act" } });
  assert.equal((await a.decide({ ...req, action: "shell" })).decision, "allow");
  const d = k.root.hook("approval/request", (p) => ({ ...p, decision: "deny", reason: "plugin says no" }));
  assert.deepEqual(await a.decide({ ...req, action: "shell" }), { decision: "deny", reason: "plugin says no" });
  await d();
});

test("an approver that throws denies", async () => {
  const k = createKernel({ log: () => {} });
  const a = createApprovals({
    ctx: k.root,
    interactive: true,
    ask: async () => {
      throw new Error("tty closed");
    },
  });
  const r = await a.decide(req);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /tty closed/);
});
