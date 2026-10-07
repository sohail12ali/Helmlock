import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SkillEntry } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { parseFrontmatter } from "./index.ts";

const skill = (base: string, folder: string, name: string, description: string) => {
  const dir = join(base, ".claude", "skills", folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
};

test("frontmatter subset: plain, quoted and folded values", () => {
  const fm = parseFrontmatter('---\nname: build\ndescription: "Build: and test"\nnotes: >\n  one\n  two\nother: x\n---\nbody: not read\n');
  assert.deepEqual(fm, { name: "build", description: "Build: and test", notes: "one two", other: "x" });
  assert.deepEqual(parseFrontmatter("no frontmatter"), {});
});

test("skill list and find cover three layers and return same-named skills from each", async () => {
  const system = mkdtempSync(join(tmpdir(), "hl-system-"));
  skill(system, "build", "build", "Build the delivery console itself and run its tests.");
  skill(system, "verify", "verify", "Review and test against acceptance criteria.");
  const ws = await createTestWorkspace({ catalog, env: { HL_DELIVERY: system } });
  try {
    skill(ws.root, "build", "build", "Build and publish the client release bundle for this workspace.");
    skill(ws.root, "glossary", "glossary", "Look up client terms and status codes.");
    skill(join(ws.root, "projects", "wms"), "publish", "publish", "Publish the WMS API to UAT.");

    const list = await ws.run("skill list", {});
    assert.ok(list.ok, JSON.stringify(list));
    const all = list.data as SkillEntry[];
    assert.deepEqual(all.map((s) => `${s.layer}:${s.folder}/${s.name}`).sort(), [
      "project:wms/publish",
      "system:system/build",
      "system:system/verify",
      "workspace:knowledge/build",
      "workspace:knowledge/glossary",
    ]);
    assert.equal(all.find((s) => s.name === "glossary")?.path, ".claude/skills/glossary/SKILL.md");

    const found = await ws.run("skill find", { query: "build" });
    assert.ok(found.ok);
    const hits = found.data as (SkillEntry & { score: number })[];
    const builds = hits.filter((h) => h.name === "build");
    assert.deepEqual(builds.map((h) => h.layer).sort(), ["system", "workspace"]);
    assert.ok(builds.every((h) => h.score > 0 && h.description));
    assert.equal(hits[0]?.name, "build");

    const byDesc = await ws.runtime.ctx.get("skills").find("acceptance criteria review");
    assert.equal(byDesc[0]?.name, "verify");
    const project = await ws.runtime.ctx.get("skills").find("publish wms");
    assert.equal(project[0]?.layer, "project");
    assert.equal(project[0]?.folder, "wms");

    const clashes = await ws.run("skill list", { same_name: true });
    assert.ok(clashes.ok);
    assert.equal((clashes.data as SkillEntry[]).length, 2);
  } finally {
    await ws.cleanup();
    rmSync(system, { recursive: true, force: true });
  }
});
