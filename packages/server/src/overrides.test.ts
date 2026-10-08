import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ApiResponse, OverridesView } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { createApp } from "./app.ts";

const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

test("GET /api/v1/overrides lists agents and skills with the winning layer and what it hides", async () => {
  const delivery = mkdtempSync(join(tmpdir(), "hl-overrides-"));
  put(join(delivery, ".claude/agents/builder.md"), "---\nname: builder\ndescription: system\n---\n");
  put(join(delivery, ".claude/skills/spec/SKILL.md"), "---\nname: spec\ndescription: system\n---\n");
  const ws = await createTestWorkspace({ catalog, env: { HL_DELIVERY: delivery } });
  try {
    put(join(ws.root, ".hl-local/agents/builder.md"), "---\nname: builder\ndescription: local\n---\n");
    const app = createApp(ws.runtime, { log: () => {} });
    const res = await app.request("/api/v1/overrides");
    assert.equal(res.status, 200);
    const body = (await res.json()) as ApiResponse<OverridesView>;
    assert.ok(body.ok);
    const data = (body as { ok: true; data: OverridesView }).data;
    assert.deepEqual(
      data.map((i) => `${i.kind} ${i.name} ${i.layer} ${i.path} < ${i.overrides.map((o) => o.layer).join(",")}`),
      ["agent builder local .hl-local/agents/builder.md < system", `skill spec system ../${delivery.split(/[\\/]/).pop()}/.claude/skills/spec < `],
    );
  } finally {
    await ws.cleanup();
    rmSync(delivery, { recursive: true, force: true });
  }
});
