import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ApiResponse, InboxItem, KnowledgeDoc, KnowledgeView, SetupStatus } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import type { Hono } from "hono";
import { createApp } from "./app.ts";

let ws: TestWorkspace;
let app: Hono;
const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

const write = (rel: string, text: string) => {
  mkdirSync(join(ws.root, rel, ".."), { recursive: true });
  writeFileSync(join(ws.root, rel), text);
};
async function get<T>(path: string): Promise<{ status: number; body: ApiResponse<T> & { error?: { rule: string } } }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as ApiResponse<T> & { error?: { rule: string } } };
}
async function data<T>(path: string): Promise<T> {
  const r = await get<T>(path);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as { ok: true; data: T }).data;
}
const post = async (key: string, body: unknown, headers: Record<string, string> = HEADERS) => {
  const res = await app.request(`/api/v1/inbox/${encodeURIComponent(key)}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: unknown; error?: { rule: string } } };
};
const digest = (id: string) =>
  `---\nclosed: 2020-01-01\n---\n# ${id} closure digest\n\n## Outcome\n\nShipped.\n\n## Decisions\n\n(none)\n\n## Key files and links\n\n(none)\n\n## Caveats\n\n(none)\n\n## Follow-ups\n\n(none)\n`;

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  write("shared/wiki/glossary.md", "# Glossary\n\nTerms used across the projects.\n");
  write("projects/wms/project.toml", 'schema_version = 1\n\n[project]\nid = "wms"\nname = "Warehouse system"\nrepos = ["wms-api"]\n');
  write("projects/wms/wiki/architecture.md", "# Architecture\n\nThree services.\n");
  write("people.secret.md", "# not served\n");
  // T-005 closed long ago with a digest: a knowledge digest and a retention suggestion.
  const tt = join(ws.root, "artifacts/T-005-sa/ticket.toml");
  writeFileSync(tt, readFileSync(tt, "utf8").replace('stage = "backlog"', 'stage = "done"').replace('size = "S"', 'size = "S"\nproject = "wms"'));
  write("artifacts/T-005-sa/T-005-sa-digest.md", digest("T-005-sa"));
  app = createApp(ws.runtime, { log: () => {} });
});
after(async () => {
  await ws.cleanup();
});

describe("knowledge", () => {
  test("GET /knowledge: index, projects and digests", async () => {
    const k = await data<KnowledgeView>("/api/v1/knowledge");
    assert.deepEqual(
      k.index.map((e) => [e.path, e.kind, e.title]),
      [
        ["projects/wms/wiki/architecture.md", "wiki", "Architecture"],
        ["shared/wiki/glossary.md", "glossary", "Glossary"],
      ],
    );
    assert.deepEqual(k.projects, [{ id: "wms", name: "Warehouse system", status: "active", owners: [], repos: ["wms-api"], goals: [], tickets: 1 }]);
    assert.deepEqual(k.digests, [
      { ticket: "T-005-sa", title: "Store opening hours page", closed: "2020-01-01", path: "artifacts/T-005-sa/T-005-sa-digest.md" },
    ]);
  });

  test("GET /knowledge/doc only inside shared/ or projects/", async () => {
    const doc = await data<KnowledgeDoc>("/api/v1/knowledge/doc?path=shared/wiki/glossary.md");
    assert.equal(doc.path, "shared/wiki/glossary.md");
    assert.match(doc.text, /^# Glossary/);
    assert.match((await data<KnowledgeDoc>("/api/v1/knowledge/doc?path=projects/wms/wiki/architecture.md")).text, /Three services/);
    for (const p of [
      "people.secret.md",
      "../x.md",
      "shared/../people.secret.md",
      "projects/wms/project.toml",
      "/etc/passwd",
      "C:/x.md",
      "shared/.obsidian/a.md",
      "",
    ]) {
      const r = await get(`/api/v1/knowledge/doc?path=${encodeURIComponent(p)}`);
      assert.equal(r.status, 400, p);
      assert.equal(r.body.error?.rule, "bad-path", p);
    }
    assert.equal((await get("/api/v1/knowledge/doc?path=shared/missing.md")).status, 404);
  });

  test("GET /setup: the first-run checklist", async () => {
    const s = await data<SetupStatus>("/api/v1/setup");
    assert.deepEqual(
      s.steps.map((x) => x.id),
      ["author", "model", "telegram", "first-ticket", "agents", "trust"],
    );
    const by = new Map(s.steps.map((x) => [x.id, x]));
    assert.equal(by.get("author")?.done, true);
    assert.equal(by.get("first-ticket")?.done, true);
    assert.equal(by.get("model")?.done, false);
    assert.equal(by.get("agents")?.done, false);
    assert.equal(by.get("agents")?.action, "hl harness sync");
  });
});

describe("inbox", () => {
  const find = (items: InboxItem[], key: string) => items.find((i) => i.key === key);

  test("derived items: blocked, questions, setup and retention", async () => {
    const items = await data<InboxItem[]>("/api/v1/inbox");
    assert.equal(find(items, "blocked:T-004-sa")?.kind, "blocked");
    assert.equal(find(items, "question:Q-001-sa")?.ticket, "T-001-sa");
    assert.equal(find(items, "setup:model")?.kind, "setup");
    assert.equal(find(items, "retention:T-005-sa")?.kind, "retention");
    assert.ok(items.every((i) => !i.read && !i.archived));
  });

  test("POST /inbox/:key has the verb-call protection", async () => {
    assert.equal((await post("blocked:T-004-sa", { archived: true }, { "content-type": "application/json" })).status, 403);
    assert.equal((await post("blocked:T-004-sa", { archived: true }, { ...HEADERS, origin: "http://evil.example" })).status, 403);
    assert.equal((await post("blocked:T-004-sa", { archived: true }, { ...HEADERS, "content-type": "text/plain" })).status, 415);
    assert.equal((await post("blocked:T-004-sa", { archived: "yes" })).status, 400);
    assert.equal((await post("blocked:T-004-sa", { pinned: true })).status, 400);
    assert.equal((await post("bad key", { read: true })).status, 400);
    const put = await app.request("/api/v1/inbox/blocked:T-004-sa", { method: "PUT", headers: HEADERS, body: "{}" });
    assert.equal(put.status, 405);
  });

  test("archive and read state persist, and an archived item resurfaces on new activity", async () => {
    const r = await post("blocked:T-004-sa", { archived: true, read: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const q = await post("question:Q-001-sa", { read: true });
    assert.equal(q.status, 200);
    const state = JSON.parse(readFileSync(join(ws.root, ".hl-cache/inbox.json"), "utf8")) as { items: Record<string, { archived_at?: string }> };
    assert.ok(state.items["blocked:T-004-sa"]?.archived_at);

    let items = await data<InboxItem[]>("/api/v1/inbox");
    assert.equal(find(items, "blocked:T-004-sa")?.archived, true);
    assert.equal(find(items, "blocked:T-004-sa")?.read, true);
    assert.equal(find(items, "question:Q-001-sa")?.read, true);

    await new Promise((res) => setTimeout(res, 15));
    const changed = await ws.run("ticket set", { id: "T-004-sa", priority: "urgent" });
    assert.ok(changed.ok, JSON.stringify(changed));
    items = await data<InboxItem[]>("/api/v1/inbox");
    assert.equal(find(items, "blocked:T-004-sa")?.archived, false, "new activity brings it back");
    assert.equal(find(items, "blocked:T-004-sa")?.read, false);
    assert.equal(find(items, "question:Q-001-sa")?.read, true);

    const un = await post("question:Q-001-sa", { read: false });
    assert.equal(un.status, 200);
    items = await data<InboxItem[]>("/api/v1/inbox");
    assert.equal(find(items, "question:Q-001-sa")?.read, false);
  });
});
