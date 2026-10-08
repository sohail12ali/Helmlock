import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import type { NotesResult } from "./notes.ts";
import { describe as describeDoc, type IndexEntry, kindOf } from "./shared-index.ts";

const write = (ws: TestWorkspace, rel: string, text: string) => {
  mkdirSync(join(ws.root, rel, ".."), { recursive: true });
  writeFileSync(join(ws.root, rel), text);
};
const read = (ws: TestWorkspace, rel: string) => readFileSync(join(ws.root, rel), "utf8");

test("notes build writes hub notes with wikilinks, is idempotent and removes stale notes", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    write(
      ws,
      "projects/wms/project.toml",
      'schema_version = 1\n\n[project]\nid = "wms"\nname = "Warehouse system"\nowners = ["sam"]\ngoals = ["Faster picking"]\n',
    );
    write(ws, "projects/wms/index.md", "# Warehouse system\n");
    const set = await ws.run("ticket set", { id: "T-001-sa", project: "wms" });
    assert.ok(set.ok, JSON.stringify(set));
    write(ws, "notes/tickets/T-099-sa.md", "stale\n");
    write(ws, "notes/README.txt", "kept\n");

    const r = await ws.run("notes build", {});
    assert.ok(r.ok, JSON.stringify(r));
    const res = r.data as NotesResult;
    assert.ok(res.written.includes("notes/tickets/T-001-sa.md"));
    assert.deepEqual(res.removed, ["notes/tickets/T-099-sa.md"]);
    assert.equal(existsSync(join(ws.root, "notes/tickets/T-099-sa.md")), false);
    assert.ok(existsSync(join(ws.root, "notes/README.txt")), "only generated note folders are cleaned");

    const t1 = read(ws, "notes/tickets/T-001-sa.md");
    assert.match(t1, /^---\ngenerated: true\ntype: ticket\nid: T-001-sa\n/);
    assert.match(t1, /^stage: spec$/m);
    assert.match(t1, /^size: M$/m);
    assert.match(t1, /^project: wms$/m);
    assert.match(t1, /^owner: sam$/m);
    assert.match(t1, /^blocked: false$/m);
    assert.match(t1, /\[\[notes\/records\/D-001-sa\|D-001-sa\]\]/);
    assert.match(t1, /\[\[notes\/records\/Q-001-sa\|Q-001-sa\]\]/);
    assert.match(t1, /\[\[artifacts\/T-001-sa\/T-001-sa-spec\|spec\]\]/);
    assert.match(t1, /\[\[notes\/projects\/wms\|wms\]\]/);
    const q = read(ws, "notes/records/Q-001-sa.md");
    assert.match(q, /^type: question$/m);
    assert.match(q, /^blocking: true$/m);
    assert.match(q, /\[\[notes\/tickets\/T-001-sa\|T-001-sa\]\]/);
    const p = read(ws, "notes/projects/wms.md");
    assert.match(p, /\[\[projects\/wms\/index\|index\]\]/);
    assert.match(p, /\[\[notes\/tickets\/T-001-sa\|T-001-sa\]\] \(spec\)/);
    assert.match(read(ws, "notes/tickets/T-004-sa.md"), /^blocked: true$/m);

    const again = await ws.run("notes build", {});
    assert.ok(again.ok);
    const r2 = again.data as NotesResult;
    assert.deepEqual(r2.written, []);
    assert.deepEqual(r2.removed, []);
    assert.equal(r2.unchanged, res.written.length);

    const one = await ws.run("notes build", { ticket: "T-002-sa" });
    assert.ok(one.ok);
    assert.equal((one.data as NotesResult).unchanged, 1);

    const dry = await ws.run("notes build", {}, { dryRun: true });
    assert.ok(dry.ok);
  } finally {
    await ws.cleanup();
  }
});

test("index build lists each document in shared/ and projects/*/wiki in one line", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    write(ws, "shared/wiki/glossary.md", "# Glossary\n\nTerms used across the projects.\n\n- **a**: b\n");
    write(ws, "shared/wiki/runbooks/deploy.md", "---\ntype: runbook\n---\n# Deploy the API\n\nHow to ship\nthe API to UAT.\n");
    write(ws, "projects/wms/wiki/architecture.md", "# Architecture\n\n> The [[shared/wiki/glossary|glossary]] *explains* terms.\n");
    write(ws, "shared/digests/T-009-sa.md", "no heading here\n");
    const r = await ws.run("index build", {});
    assert.ok(r.ok, JSON.stringify(r));
    const entries = (r.data as { entries: IndexEntry[] }).entries;
    assert.deepEqual(
      entries.map((e) => [e.path, e.kind, e.title, e.summary]),
      [
        ["projects/wms/wiki/architecture.md", "wiki", "Architecture", "The glossary explains terms."],
        ["shared/digests/T-009-sa.md", "digest", "T-009-sa", "no heading here"],
        ["shared/wiki/glossary.md", "glossary", "Glossary", "Terms used across the projects."],
        ["shared/wiki/runbooks/deploy.md", "runbook", "Deploy the API", "How to ship the API to UAT."],
      ],
    );
    const text = read(ws, "shared/INDEX.md");
    assert.match(text, /^- `shared\/wiki\/glossary\.md` \(glossary\) \*\*Glossary\*\*: Terms used across the projects\.$/m);
    assert.equal(text.split("\n").filter((l) => l.startsWith("- ")).length, 4);
    const again = await ws.run("index build", {});
    assert.ok(again.ok);
    assert.equal((again.data as { changed: boolean }).changed, false);
  } finally {
    await ws.cleanup();
  }
});

test("kindOf and describe", () => {
  assert.equal(kindOf("shared/wiki/decisions/d1.md"), "decision");
  assert.equal(kindOf("shared/wiki/standards/sql.md"), "standard");
  assert.equal(kindOf("shared/templates/t.md"), "template");
  assert.equal(kindOf("shared/checklists/c.md"), "checklist");
  assert.equal(kindOf("shared/other.md"), "other");
  const d = describeDoc("x.md", `# T\n\n${"long ".repeat(80)}\n`);
  assert.ok(d.summary.length <= 160 && d.summary.endsWith("..."));
});
