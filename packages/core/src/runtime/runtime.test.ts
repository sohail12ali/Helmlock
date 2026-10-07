import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "@helmlock/plugins";
import { createTestWorkspace } from "../testing.ts";

test("where resolves the fixture workspace", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const res = await ws.run("where");
    assert.ok(res.ok);
    const data = res.data as { author: string; name: string };
    assert.equal(data.author, "sam");
    assert.equal(data.name, "Test");
  } finally {
    await ws.cleanup();
  }
});

test("mountAll mounts every stub plugin", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const results = await ws.runtime.mountAll();
    assert.deepEqual(
      results.filter((r) => r.state === "failed"),
      [],
    );
    assert.equal(results.length, 15);
  } finally {
    await ws.cleanup();
  }
});
