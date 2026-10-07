import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";

test("roster lists people.toml and resolves the author from author.local", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    await ws.runtime.mountForVerb("log-work");
    const roster = ws.runtime.ctx.get("roster");
    assert.deepEqual(
      (await roster.list()).map((p) => p.id),
      ["sam"],
    );
    assert.equal((await roster.get("sam"))?.initials, "sa");
    assert.equal(await roster.get("nobody"), undefined);
    assert.equal((await roster.current()).id, "sam");
  } finally {
    await ws.cleanup();
  }
});

test("an author missing from the roster is refused, never guessed", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "s4-unknown-author" });
  try {
    await ws.runtime.mountForVerb("log-work");
    await assert.rejects(ws.runtime.ctx.get("roster").current(), (e: Error & { rule?: string; fix?: string }) => {
      assert.equal(e.rule, "unknown-author");
      assert.match(e.message, /nobody/);
      assert.match(e.message, /author\.local/);
      assert.match(e.message, /people\.toml/);
      assert.equal(e.fix, "add yourself to people.toml or fix author.local");
      return true;
    });
    const res = await ws.run("log-work", { ticket: "-", text: "Wrote the format map" });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, 1);
      assert.equal(res.error.rule, "unknown-author");
    }
    const todo = await ws.run("todo add", { text: "Ask ops for access" });
    assert.equal(todo.ok, false);
    if (!todo.ok) assert.equal(todo.error.rule, "unknown-author");
  } finally {
    await ws.cleanup();
  }
});
