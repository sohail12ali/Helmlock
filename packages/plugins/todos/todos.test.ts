import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TodoRecord } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";

test("todo add, done and list", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const a = await ws.run("todo add", { text: "Ask ops for the UAT login" });
    assert.ok(a.ok);
    assert.equal((a.data as TodoRecord).id, "TD-001-sa");
    const b = await ws.run("todo add", { text: "Review the spec", ticket: "T-014-sa", due: "2026-10-09", priority: "high" });
    assert.ok(b.ok);
    assert.equal((b.data as TodoRecord).id, "TD-002-sa");

    const file = join(ws.root, "todos/TD-002-sa.toml");
    assert.ok(existsSync(file));
    const onDisk = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(onDisk.text, "Review the spec");
    assert.equal(onDisk.ticket, "T-014-sa");
    assert.equal(onDisk.author, "sam");
    assert.equal(onDisk.status, "open");

    const dry = await ws.run("todo add", { text: "Not written" }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal(existsSync(join(ws.root, "todos/TD-003-sa.toml")), false);

    const done = await ws.run("todo done", { id: "TD-001-sa" });
    assert.ok(done.ok);
    assert.equal((done.data as TodoRecord).status, "done");
    assert.equal((parse(readFileSync(join(ws.root, "todos/TD-001-sa.toml"), "utf8")) as Record<string, unknown>).status, "done");

    const open = await ws.run("todo list", {});
    assert.ok(open.ok);
    assert.deepEqual(
      (open.data as TodoRecord[]).map((t) => t.id),
      ["TD-002-sa"],
    );
    const all = await ws.run("todo list", { all: true });
    assert.ok(all.ok);
    assert.equal((all.data as TodoRecord[]).length, 2);
    const byTicket = await ws.runtime.ctx.get("todos").list({ ticket: "T-014-sa" });
    assert.equal(byTicket.length, 1);

    const missing = await ws.run("todo done", { id: "TD-099-sa" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.rule, "not-found");
  } finally {
    await ws.cleanup();
  }
});
