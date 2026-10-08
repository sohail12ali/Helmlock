// Milestone 7: GET /projects, GET /centers (recent list in a temp home) and POST /runs { project }.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ApiResponse, CentersView, ProjectsView, SetupStatus } from "@helmlock/core";
import { createTestWorkspace, DELIVERY_ROOT, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { recordRecent } from "@helmlock/plugins/scaffold/recent.ts";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { probeConsole, projectCwd } from "./projects.ts";

let ws: TestWorkspace;
let app: Hono;
let home: string;
let outside: string;
const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}
async function data<T>(path: string): Promise<T> {
  const r = await call<T>(path);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
}
const write = (rel: string, text: string) => {
  mkdirSync(join(ws.root, rel, ".."), { recursive: true });
  writeFileSync(join(ws.root, rel), text);
};

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  home = mkdtempSync(join(tmpdir(), "hl-home-"));
  outside = mkdtempSync(join(tmpdir(), "hl-repos-"));
  mkdirSync(join(outside, "wms-api"));
  app = createApp(ws.runtime, { log: () => {}, home });
});
after(async () => {
  await ws.cleanup();
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("projects", () => {
  test("setup: Connect your code is open until a project exists", async () => {
    const s = await data<SetupStatus>("/api/v1/setup");
    const ids = s.steps.map((x) => x.id);
    assert.ok(ids.indexOf("code") < ids.indexOf("first-ticket"));
    assert.equal(s.steps.find((x) => x.id === "code")?.done, false);
  });

  test("GET /projects resolves repo folders through the live workspace file", async () => {
    assert.deepEqual(await data<ProjectsView>("/api/v1/projects"), { projects: [] });
    // Written after the server started: the projects list and the folders are read live.
    write("projects/wms/project.toml", 'schema_version = 1\n\n[project]\nid = "wms"\nname = "Warehouse"\nrepos = ["wms-api", "wms-docs"]\n');
    write("projects/web/project.toml", 'schema_version = 1\n\n[project]\nid = "web"\nname = "Web"\nrepos = ["system"]\n');
    write(
      "Test.code-workspace",
      JSON.stringify({
        folders: [
          { name: "knowledge", path: "." },
          { name: "system", path: DELIVERY_ROOT },
          { name: "wms-api", path: join(outside, "wms-api") },
          { name: "wms-docs", path: join(outside, "wms-docs") },
        ],
      }),
    );
    const v = await data<ProjectsView>("/api/v1/projects");
    assert.deepEqual(
      v.projects.map((p) => p.id),
      ["web", "wms"],
    );
    const wms = v.projects.find((p) => p.id === "wms")!;
    assert.equal(wms.name, "Warehouse");
    assert.deepEqual(
      wms.repos.map((r) => [r.folder, r.exists]),
      [
        ["wms-api", true],
        ["wms-docs", false],
      ],
    );
    assert.equal(wms.repos[0]?.path, join(outside, "wms-api"));
    // The system repo is never a project folder.
    assert.deepEqual(v.projects.find((p) => p.id === "web")?.repos, [{ folder: "system", exists: false }]);
    const s = await data<SetupStatus>("/api/v1/setup");
    assert.equal(s.steps.find((x) => x.id === "code")?.done, true);
  });

  test("a run for a project starts in its repo folder, only one the workspace file names", async () => {
    assert.equal(await projectCwd(ws.runtime, "wms"), join(outside, "wms-api"));
    await assert.rejects(projectCwd(ws.runtime, "web"), (e: { rule?: string }) => e.rule === "no-repo-folder");
    const unknown = await call("/api/v1/runs", { method: "POST", headers: HEADERS, body: JSON.stringify({ task: "look", project: "nope" }) });
    assert.equal(unknown.status, 404);
    assert.equal(!unknown.body.ok && unknown.body.error.rule, "unknown-project");
    const noFolder = await call("/api/v1/runs", { method: "POST", headers: HEADERS, body: JSON.stringify({ task: "look", project: "web" }) });
    assert.equal(noFolder.status, 422);
    const bad = await call("/api/v1/runs", { method: "POST", headers: HEADERS, body: JSON.stringify({ task: "look", project: "../x" }) });
    assert.equal(bad.status, 400);
  });
});

describe("centers", () => {
  let fake: Server;
  let port: number;
  const shop = () => join(outside, "shop-knowledge");

  before(async () => {
    mkdirSync(shop(), { recursive: true });
    // A stand-in for another console: answers /api/v1/workspace with its root.
    fake = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/api/v1/workspace" ? { ok: true, data: { root: shop() } } : { ok: false }));
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    port = (fake.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((r) => fake.close(() => r())));

  test("probeConsole checks the port answers for that root", async () => {
    assert.equal(await probeConsole(port, shop()), true);
    assert.equal(await probeConsole(port, ws.root), false);
  });

  test("GET /centers: this center, and the others with running or the command to run", async () => {
    let v = await data<CentersView>("/api/v1/centers");
    assert.equal(v.current.root, ws.root);
    assert.equal(v.current.name, "Test"); // workspace.toml [workspace] name
    assert.equal(v.current.console_name, "Test Console");
    assert.deepEqual(v.others, []);

    recordRecent(home, { name: "Demo", root: ws.root, port: 4317 });
    recordRecent(home, { name: "Shop", root: shop(), port });
    mkdirSync(join(outside, "old"));
    recordRecent(home, { name: "Old", root: join(outside, "old"), port: 4400, last_opened: "2020-01-01T00:00:00.000Z" });
    recordRecent(home, { name: "Gone", root: join(outside, "gone"), port: 4401 });
    v = await data<CentersView>("/api/v1/centers");
    assert.deepEqual(
      v.others.map((c) => [c.name, c.running, c.url ?? null, c.command]),
      [
        ["Shop", true, `http://127.0.0.1:${port}/`, `hl serve --port ${port}`],
        ["Old", false, null, "hl serve --port 4400"],
      ],
    );
  });
});
