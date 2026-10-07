import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TodoRecord } from "@helmlock/core";
import { scopeDir, scopeOfPath } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";

const ids = (r: { data?: unknown }) => (r.data as TodoRecord[]).map((t) => t.id);

test("scope helpers map scopes to folders and back", () => {
  assert.equal(scopeDir("team", "todos"), "todos");
  assert.equal(scopeDir("personal", "todos", "sam"), "people/sam/todos");
  assert.equal(scopeDir("private", "todos"), ".hl-local/todos");
  assert.throws(() => scopeDir("personal", "todos"));
  assert.deepEqual(scopeOfPath("todos/TD-001-sa.toml"), { scope: "team" });
  assert.deepEqual(scopeOfPath("people/ann/todos/TD-001-al.toml"), { scope: "personal", slug: "ann" });
  assert.deepEqual(scopeOfPath(".hl-local\\todos\\TD-001-sa.toml"), { scope: "private" });
});

test("todo add, done and list (personal by default)", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const a = await ws.run("todo add", { text: "Ask ops for the UAT login" });
    assert.ok(a.ok);
    assert.equal((a.data as TodoRecord).id, "TD-001-sa");
    assert.equal((a.data as TodoRecord).scope, "personal");
    const b = await ws.run("todo add", { text: "Review the spec", ticket: "T-014-sa", due: "2026-10-09", priority: "high" });
    assert.ok(b.ok);
    assert.equal((b.data as TodoRecord).id, "TD-002-sa");

    const file = join(ws.root, "people/sam/todos/TD-002-sa.toml");
    assert.ok(existsSync(file));
    const onDisk = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(onDisk.text, "Review the spec");
    assert.equal(onDisk.ticket, "T-014-sa");
    assert.equal(onDisk.author, "sam");
    assert.equal(onDisk.status, "open");
    assert.equal(onDisk.scope, "personal");

    const dry = await ws.run("todo add", { text: "Not written" }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal(existsSync(join(ws.root, "people/sam/todos/TD-003-sa.toml")), false);

    const done = await ws.run("todo done", { id: "TD-001-sa" });
    assert.ok(done.ok);
    assert.equal((done.data as TodoRecord).status, "done");
    assert.equal((parse(readFileSync(join(ws.root, "people/sam/todos/TD-001-sa.toml"), "utf8")) as Record<string, unknown>).status, "done");

    const open = await ws.run("todo list", {});
    assert.ok(open.ok);
    assert.deepEqual(ids(open), ["TD-002-sa"]);
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

test("todo scopes: team, personal and private files, unique ids, move, list filters", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    // ws-demo already has todos/TD-001-sa.toml (no scope field): it is a team todo.
    const team = await ws.run("todo add", { text: "Book the demo room", scope: "team" });
    const mine = await ws.run("todo add", { text: "Read the spec" });
    const secret = await ws.run("todo add", { text: "Call the dentist about the crown", scope: "private" });
    assert.ok(team.ok && mine.ok && secret.ok);
    assert.deepEqual(
      [team, mine, secret].map((r) => (r.data as TodoRecord).id),
      ["TD-002-sa", "TD-003-sa", "TD-004-sa"],
      "one counter across all three places",
    );
    assert.ok(existsSync(join(ws.root, "todos/TD-002-sa.toml")));
    assert.ok(existsSync(join(ws.root, "people/sam/todos/TD-003-sa.toml")));
    assert.ok(existsSync(join(ws.root, ".hl-local/todos/TD-004-sa.toml")));

    // The private text never reaches a committed file: the activity line carries the id only.
    const activity = join(ws.root, "activity");
    const texts: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : texts.push(readFileSync(join(d, e.name), "utf8"));
    };
    walk(activity);
    const all = texts.join("\n");
    assert.match(all, /TD-004-sa/);
    assert.doesNotMatch(all, /dentist/);

    // Someone else's personal list (pulled from git) and a stray file whose scope field lies.
    mkdirSync(join(ws.root, "people/ann/todos"), { recursive: true });
    writeFileSync(
      join(ws.root, "people/ann/todos/TD-001-al.toml"),
      'schema_version = 1\nid = "TD-001-al"\ntext = "Ann\'s own"\nstatus = "open"\npriority = "normal"\ncreated = "2026-10-07T09:00:00.000Z"\nauthor = "ann"\nscope = "team"\n',
    );

    const def = await ws.run("todo list", {});
    assert.ok(def.ok);
    assert.deepEqual(ids(def).sort(), ["TD-001-sa", "TD-002-sa", "TD-003-sa", "TD-004-sa"], "team + my personal + my private");
    const scopes = Object.fromEntries((def.data as TodoRecord[]).map((t) => [t.id, t.scope]));
    assert.deepEqual(scopes, { "TD-001-sa": "team", "TD-002-sa": "team", "TD-003-sa": "personal", "TD-004-sa": "private" });

    const everyone = await ws.run("todo list", { all: true });
    assert.ok(everyone.ok);
    assert.ok(ids(everyone).includes("TD-001-al"));
    assert.equal((everyone.data as TodoRecord[]).find((t) => t.id === "TD-001-al")?.scope, "personal", "the location wins over the field");

    const onlyTeam = await ws.run("todo list", { scope: "team" });
    assert.deepEqual(ids(onlyTeam).sort(), ["TD-001-sa", "TD-002-sa"]);

    // move keeps the id and moves the file
    const dryMove = await ws.run("todo move", { id: "TD-004-sa", scope: "team" }, { dryRun: true });
    assert.ok(dryMove.ok);
    assert.ok(existsSync(join(ws.root, ".hl-local/todos/TD-004-sa.toml")));
    const moved = await ws.run("todo move", { id: "TD-003-sa", scope: "private" });
    assert.ok(moved.ok);
    assert.equal((moved.data as TodoRecord).id, "TD-003-sa");
    assert.equal((moved.data as TodoRecord).scope, "private");
    assert.equal(existsSync(join(ws.root, "people/sam/todos/TD-003-sa.toml")), false);
    assert.equal((parse(readFileSync(join(ws.root, ".hl-local/todos/TD-003-sa.toml"), "utf8")) as Record<string, unknown>).scope, "private");
    const back = await ws.run("todo move", { id: "TD-001-sa", scope: "personal" });
    assert.ok(back.ok);
    assert.ok(existsSync(join(ws.root, "people/sam/todos/TD-001-sa.toml")));

    const same = await ws.run("todo move", { id: "TD-002-sa", scope: "team" });
    assert.equal(same.ok, false);
    if (!same.ok) assert.equal(same.error.rule, "same-scope");
    const notMine = await ws.run("todo move", { id: "TD-001-al", scope: "team" });
    assert.equal(notMine.ok, false);
    if (!notMine.ok) assert.equal(notMine.error.rule, "not-owner");

    // done finds a todo wherever it is
    const done = await ws.run("todo done", { id: "TD-003-sa" });
    assert.ok(done.ok);
    assert.equal((done.data as TodoRecord).scope, "private");

    const next = await ws.run("todo add", { text: "After the move" });
    assert.equal((next.data as TodoRecord).id, "TD-005-sa");
  } finally {
    await ws.cleanup();
  }
});
