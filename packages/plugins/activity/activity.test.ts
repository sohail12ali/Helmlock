import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { activityPath } from "./index.ts";

test("activity is one JSONL file per person per day", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    await ws.runtime.mountForVerb("todo list");
    const activity = ws.runtime.ctx.get("activity");
    const base = { verb: "ticket move", code: 0 as const };
    await activity.append({ ...base, ts: "2026-10-07T09:00:00", actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", entity: "T-001-sa" });
    await activity.append({ ...base, ts: "2026-10-07T10:00:00", actor: { kind: "agent", id: "builder" }, on_behalf_of: "sam" });
    await activity.append({ ...base, ts: "2026-10-07T09:30:00", actor: { kind: "person", id: "jo" }, on_behalf_of: "jo" });
    await activity.append({ ...base, ts: "2026-10-08T09:00:00", actor: { kind: "person", id: "sam" }, on_behalf_of: "sam" });

    assert.equal(activityPath("2026-10-07", "sam"), "activity/2026-10/07.sam.jsonl");
    assert.ok(existsSync(join(ws.root, "activity/2026-10/07.sam.jsonl")));
    assert.ok(existsSync(join(ws.root, "activity/2026-10/07.jo.jsonl")));
    assert.ok(existsSync(join(ws.root, "activity/2026-10/08.sam.jsonl")));
    assert.equal(readFileSync(join(ws.root, "activity/2026-10/07.sam.jsonl"), "utf8").trim().split("\n").length, 2);

    const sam = await activity.read("2026-10-07", "sam");
    assert.deepEqual(
      sam.map((l) => l.actor.id),
      ["sam", "builder"],
    );
    const all = await activity.read("2026-10-07");
    assert.deepEqual(
      all.map((l) => l.on_behalf_of),
      ["sam", "jo", "sam"],
    );
    assert.deepEqual(await activity.read("2026-10-09"), []);

    // A default timestamp lands in today's file.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const before = (await activity.read(today, "sam")).length;
    await activity.append({ ...base, actor: { kind: "person", id: "sam" }, on_behalf_of: "sam" });
    assert.equal((await activity.read(today, "sam")).length, before + 1);
  } finally {
    await ws.cleanup();
  }
});
