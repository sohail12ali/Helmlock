// Folder picker: GET /api/v1/fs/list lists folder names (and workspace files in mode workspace), never contents.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ApiResponse, FsListing } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { fsRoots, listFolder, skipName } from "./fs-list.ts";

let ws: TestWorkspace;
let app: Hono;
let home: string;
let dir: string;
const SECRET = "secret-file-contents-do-not-leak";

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: ApiResponse<FsListing>; text: string }> {
  const res = await app.request(path, init);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as ApiResponse<FsListing>, text };
}
const q = (path: string, mode?: string) => `/api/v1/fs/list?path=${encodeURIComponent(path)}${mode ? `&mode=${mode}` : ""}`;

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  home = mkdtempSync(join(tmpdir(), "hl-home-"));
  dir = mkdtempSync(join(tmpdir(), "hl-pick-"));
  mkdirSync(join(dir, "repo-a", ".git"), { recursive: true });
  mkdirSync(join(dir, "with-ws"));
  writeFileSync(join(dir, "with-ws", "Shop.code-workspace"), SECRET);
  mkdirSync(join(dir, "plain"));
  mkdirSync(join(dir, "Zeta"));
  mkdirSync(join(dir, ".hidden"));
  mkdirSync(join(dir, "node_modules"));
  mkdirSync(join(dir, "$Recycle.Bin"));
  writeFileSync(join(dir, "notes.txt"), SECRET);
  writeFileSync(join(dir, "Team.code-workspace"), SECRET);
  app = createApp(ws.runtime, { log: () => {}, home });
});
after(async () => {
  await ws.cleanup();
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/v1/fs/list", () => {
  test("mode folder: folders only, sorted, with git and workspace chips; hidden folders and files skipped", async () => {
    const r = await call(q(dir));
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.ok);
    const v = r.body.data;
    assert.equal(v.path, dir);
    assert.equal(v.parent, dirname(dir));
    assert.deepEqual(
      v.entries.map((e) => [e.name, e.kind, e.git, e.workspace]),
      [
        ["plain", "folder", false, false],
        ["repo-a", "folder", true, false],
        ["with-ws", "folder", false, true],
        ["Zeta", "folder", false, false],
      ],
    );
    assert.equal(v.entries[1]!.path, join(dir, "repo-a"));
    assert.equal(v.truncated, false);
    assert.ok(!r.text.includes(SECRET), "file contents never returned");
    assert.ok(!r.text.includes("notes.txt"));
    assert.ok(v.roots.length > 0);
    assert.ok(v.shortcuts.some((s) => s.path === home));
    assert.ok(v.shortcuts.some((s) => s.path === dirname(ws.root)));
  });

  test("mode workspace also lists *.code-workspace files, still never their contents", async () => {
    const r = await call(q(dir, "workspace"));
    assert.ok(r.body.ok, r.text);
    const files = r.body.data.entries.filter((e) => e.kind === "workspace-file");
    assert.deepEqual(
      files.map((e) => [e.name, e.path]),
      [["Team.code-workspace", join(dir, "Team.code-workspace")]],
    );
    assert.equal(r.body.data.entries.at(-1)?.kind, "workspace-file"); // after the folders
    assert.ok(!r.text.includes(SECRET));
    assert.ok(!r.text.includes("notes.txt"));
  });

  test("no path lists the knowledge repo's parent folder", async () => {
    const r = await call("/api/v1/fs/list");
    assert.ok(r.body.ok, r.text);
    assert.equal(r.body.data.path, dirname(ws.root));
  });

  test("bad paths are clear errors", async () => {
    const missing = await call(q(join(dir, "nope")));
    assert.equal(missing.status, 404);
    assert.ok(!missing.body.ok && /does not exist/.test(missing.body.error.message));
    const file = await call(q(join(dir, "notes.txt")));
    assert.equal(file.status, 400);
    assert.ok(!file.body.ok && /not a folder/.test(file.body.error.message));
    const rel = await call(q("some/relative"));
    assert.equal(rel.status, 400);
    assert.ok(!rel.body.ok && /absolute/.test(rel.body.error.message));
    const mode = await call(q(dir, "files"));
    assert.equal(mode.status, 400);
  });

  test("is read-only and checks the Host like every API route", async () => {
    const post = await app.request(q(dir), { method: "POST" });
    assert.equal(post.status, 405);
    const evil = await app.request(`http://evil.example${q(dir)}`, { headers: { host: "evil.example" } });
    assert.equal(evil.status, 403);
  });

  test("caps the list and flags it", () => {
    const v = listFolder(ws.runtime, { path: dir, max: 2, home });
    assert.equal(v.entries.length, 2);
    assert.equal(v.truncated, true);
  });

  test("helpers: skipped names and roots", () => {
    for (const n of [".git", ".hidden", "$Recycle.Bin", "System Volume Information", "node_modules"]) assert.ok(skipName(n), n);
    assert.ok(!skipName("src"));
    assert.deepEqual(fsRoots("linux"), ["/"]);
    if (process.platform === "win32") assert.ok(fsRoots().every((r) => /^[A-Z]:\\$/.test(r)));
  });
});
