import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { SchemaVersionError, StaleWriteError } from "../contracts/files.ts";
import { CommentLine, TasksToml, TicketToml, WorkLogDay } from "../contracts/schemas.ts";
import { defineEmitter } from "../schemas/define-emitter.ts";
import { createFileLayer, PathOutsideWorkspaceError, UnknownEmitterError } from "./file-layer.ts";

const FIXTURES = resolve(import.meta.dirname, "../../../../test/fixtures/s2-toml");

// Test emitters (the real ones belong to the ticket and log plugins). Version 2 of the ticket renames assignee -> owner.
const ticketEmitter = defineEmitter({
  kind: "ticket",
  schema: TicketToml,
  version: 2,
  order: {
    "": ["schema_version", "ticket", "flags", "claim", "links", "changes"],
    ticket: ["id", "title", "summary", "stage", "size", "priority", "owner", "project", "goal", "created", "updated"],
    flags: ["blocked", "blocked_by", "next_action"],
    claim: ["claimed_by", "claimed_at"],
    links: ["parent", "related"],
    changes: ["repo", "branch"],
  },
  migrations: {
    1: (d) => {
      const { assignee, ...ticket } = d.ticket as Record<string, unknown>;
      return { ...d, ticket: { ...ticket, owner: assignee } };
    },
  },
});
const tasksEmitter = defineEmitter({
  kind: "tasks",
  schema: TasksToml,
  version: 1,
  order: {
    "": ["schema_version", "ticket", "task"],
    task: ["id", "slice", "title", "layer", "acs", "estimate_h", "actual_h", "status", "depends", "files"],
  },
});
const worklogEmitter = defineEmitter({
  kind: "worklog-day",
  schema: WorkLogDay,
  version: 1,
  order: {
    "": ["schema_version", "day", "entry"],
    day: ["date", "author", "day_hours"],
    entry: ["ticket", "category", "text", "weight", "hours", "logged"],
  },
});

let root: string;
const fresh = () => {
  const files = createFileLayer(root);
  files.registerEmitter(ticketEmitter);
  files.registerEmitter(tasksEmitter);
  files.registerEmitter(worklogEmitter);
  return files;
};
const disk = (rel: string) => readFileSync(join(root, rel), "utf8");

before(() => {
  root = mkdtempSync(join(tmpdir(), "hl-s2-"));
  cpSync(FIXTURES, join(root, "fx"), { recursive: true });
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("golden round trip: write(read(x)) is byte-identical", () => {
  for (const [file, kind] of [
    ["ticket.toml", "ticket"],
    ["tasks.toml", "tasks"],
    ["worklog.toml", "worklog-day"],
  ] as const) {
    test(file, async () => {
      const files = fresh();
      const golden = readFileSync(join(FIXTURES, file), "utf8").replace(/\r\n/g, "\n");
      writeFileSync(join(root, "fx", file), golden);
      const { data, hash } = await files.readToml(`fx/${file}`, kind);
      const res = await files.writeToml(`fx/${file}`, kind, data, { expectHash: hash });
      assert.equal(res.text, golden);
      assert.equal(res.changed, false);
      assert.equal(disk(`fx/${file}`), golden);
    });
  }

  test("a fresh file layer (no read hints) is still a fixed point after one write", async () => {
    const a = fresh();
    const { data } = await a.readToml<TasksToml>("fx/tasks.toml", "tasks");
    const once = (await a.writeToml("fx/tasks-copy.toml", "tasks", data)).text;
    const b = fresh();
    const again = (await b.writeToml("fx/tasks-copy.toml", "tasks", (await b.readToml("fx/tasks-copy.toml", "tasks")).data)).text;
    assert.equal(again, once);
  });
});

describe("closed emitters", () => {
  test("key order follows the emitter, not the input object", async () => {
    const files = fresh();
    const res = await files.writeToml(
      "fx/order.toml",
      "worklog-day",
      { entry: [{ logged: "2026-10-07T09:00:00Z", text: "x", category: "Testing" }], day: { author: "sohail", date: "2026-10-07" } },
      { dryRun: true },
    );
    assert.equal(
      res.text,
      [
        "schema_version = 1",
        "",
        "[day]",
        'date = "2026-10-07"',
        'author = "sohail"',
        "",
        "[[entry]]",
        'ticket = "-"',
        'category = "Testing"',
        'text = "x"',
        'logged = "2026-10-07T09:00:00Z"',
        "",
      ].join("\n"),
    );
  });

  test("an unregistered kind is refused (no generic dumper)", async () => {
    await assert.rejects(fresh().writeToml("fx/x.toml", "nope", { a: 1 }), UnknownEmitterError);
    await assert.rejects(fresh().readToml("fx/ticket.toml", "nope"), UnknownEmitterError);
  });

  test("invalid data is refused before anything is written", async () => {
    await assert.rejects(fresh().writeToml("fx/bad.toml", "tasks", { ticket: "not-an-id" }));
    assert.equal(existsSync(join(root, "fx/bad.toml")), false);
  });

  test("a disposed emitter is gone", async () => {
    const files = createFileLayer(root);
    const off = files.registerEmitter(tasksEmitter);
    assert.throws(() => files.registerEmitter(tasksEmitter));
    await off();
    await assert.rejects(files.readToml("fx/tasks.toml", "tasks"), UnknownEmitterError);
  });
});

describe("unknown keys", () => {
  test("a key unknown to the schema survives read -> modify a known key -> write", async () => {
    const files = fresh();
    const { data, hash } = await files.readToml<TicketToml>("fx/ticket.toml", "ticket");
    data.ticket.stage = "verify";
    const res = await files.writeToml("fx/ticket.toml", "ticket", data, { expectHash: hash });
    assert.equal(res.changed, true);
    const text = disk("fx/ticket.toml");
    assert.match(text, /^stage = "verify"$/m);
    assert.match(text, /^origin = "import"$/m); // root
    assert.match(text, /^feature_name = "tiktok-invoice-window"$/m); // inside a known table
    assert.match(text, /^projects = \["Database-Scripts"\]$/m); // inside an array of tables
    assert.match(text, /^\[notes\.history\]\nmoved = 3$/m); // unknown table with a sub-table
    assert.match(text, /^weight = 2\.0$/m); // a float stays a float
    // restore for other tests
    data.ticket.stage = "build";
    await files.writeToml("fx/ticket.toml", "ticket", data);
  });

  test("unknown keys from the last read are kept even if the caller rebuilt the object", async () => {
    const files = fresh();
    const { data } = await files.readToml<TicketToml>("fx/ticket.toml", "ticket");
    const rebuilt = { schema_version: 2, ticket: { ...data.ticket } };
    const res = await files.writeToml("fx/ticket.toml", "ticket", rebuilt, { dryRun: true });
    assert.match(res.text, /^origin = "import"$/m);
    assert.match(res.text, /^\[notes\]$/m);
  });
});

describe("schema_version", () => {
  test("a newer file is refused", async () => {
    await assert.rejects(fresh().readToml("fx/ticket-v3.toml", "ticket"), (e: unknown) => {
      assert.ok(e instanceof SchemaVersionError);
      assert.equal(e.rule, "schema-version");
      return true;
    });
  });

  test("an older file is migrated in memory and rewritten only on the next write", async () => {
    const files = fresh();
    const before = disk("fx/ticket-v1.toml");
    const { data } = await files.readToml<TicketToml>("fx/ticket-v1.toml", "ticket");
    assert.equal(data.schema_version, 2);
    assert.equal(data.ticket.owner, "om-prakash");
    assert.equal((data.ticket as Record<string, unknown>).assignee, undefined);
    assert.equal(data.ticket.created, "2026-09-17"); // bare TOML date read as a string
    assert.equal(disk("fx/ticket-v1.toml"), before);
    const res = await files.writeToml("fx/ticket-v1.toml", "ticket", data);
    assert.match(res.text, /^schema_version = 2$/m);
    assert.match(res.text, /^owner = "om-prakash"$/m);
    assert.match(res.text, /^created = 2026-09-17$/m); // still a bare date
    assert.doesNotMatch(res.text, /assignee|#/);
  });

  test("a missing migration step is an error", async () => {
    const files = createFileLayer(root);
    files.registerEmitter(defineEmitter({ ...ticketEmitter, kind: "ticket-nomig", migrations: {} }));
    cpSync(join(FIXTURES, "ticket-v1.toml"), join(root, "fx/ticket-v1-copy.toml"));
    await assert.rejects(files.readToml("fx/ticket-v1-copy.toml", "ticket-nomig"), /no migration from schema_version 1/);
  });
});

describe("atomic writes", () => {
  test("a stale write is refused", async () => {
    const files = fresh();
    const { data, hash } = await files.readToml<TasksToml>("fx/tasks.toml", "tasks");
    writeFileSync(join(root, "fx/tasks.toml"), `${disk("fx/tasks.toml")}\n`);
    await assert.rejects(files.writeToml("fx/tasks.toml", "tasks", data, { expectHash: hash }), (e: unknown) => {
      assert.ok(e instanceof StaleWriteError);
      assert.equal(e.rule, "stale-write");
      return true;
    });
    await assert.rejects(files.writeText("fx/gone.md", "x", { expectHash: hash }), StaleWriteError);
  });

  test("dry run returns the text and touches nothing", async () => {
    const files = fresh();
    const res = await files.writeText("fx/dry/new.md", "hello\n", { dryRun: true });
    assert.equal(res.text, "hello\n");
    assert.equal(res.changed, true);
    assert.equal(existsSync(join(root, "fx/dry")), false);
    const { data } = await files.readToml<TasksToml>("fx/tasks.toml", "tasks");
    const before = disk("fx/tasks.toml");
    await files.writeToml("fx/tasks.toml", "tasks", { ...data, ticket: "T-999-sa" }, { dryRun: true });
    assert.equal(disk("fx/tasks.toml"), before);
    await files.appendJsonl("fx/dry/log.jsonl", { a: 1 }, { dryRun: true });
    await files.remove("fx/tasks.toml", { dryRun: true });
    assert.equal(existsSync(join(root, "fx/dry")), false);
    assert.equal(existsSync(join(root, "fx/tasks.toml")), true);
  });

  test("writeText creates folders, reports changed, leaves no lock or temp file", async () => {
    const files = fresh();
    const a = await files.writeText("fx/w/a/b.md", "one\n");
    assert.equal(a.changed, true);
    assert.equal(a.path, "fx/w/a/b.md");
    const b = await files.writeText("fx/w/a/b.md", "one\n", { expectHash: a.hash });
    assert.equal(b.changed, false);
    assert.deepEqual(readdirSync(join(root, "fx/w/a")), ["b.md"]);
  });

  test("parallel writers to one file serialise through the lock", async () => {
    const files = fresh();
    await Promise.all(Array.from({ length: 20 }, (_, i) => files.writeText("fx/w/race.md", `writer ${i}\n`)));
    assert.match(disk("fx/w/race.md"), /^writer \d+\n$/);
    assert.deepEqual(readdirSync(join(root, "fx/w")).sort(), ["a", "race.md"]);
  });

  test("a stale lock (older than 30 s) is taken over", async () => {
    const files = fresh();
    const lock = join(root, "fx/w/locked.md.lock");
    writeFileSync(lock, "99999\n");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    await files.writeText("fx/w/locked.md", "ok\n");
    assert.equal(disk("fx/w/locked.md"), "ok\n");
    assert.equal(existsSync(lock), false);
  });
});

describe("jsonl", () => {
  test("50 parallel appends stay whole lines", async () => {
    const files = fresh();
    const text = "x".repeat(2000);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => files.appendJsonl("fx/logs/comments.jsonl", { ts: `2026-10-07T00:00:${i}`, author: "sohail", text: `${i}${text}` })),
    );
    const rows = await files.readJsonl("fx/logs/comments.jsonl", CommentLine);
    assert.equal(rows.length, 50);
    assert.deepEqual(
      rows.map((r) => Number.parseInt(r.text, 10)).sort((a, b) => a - b),
      Array.from({ length: 50 }, (_, i) => i),
    );
    assert.ok(rows.every((r) => r.text.endsWith(text)));
  });

  test("a missing file reads as empty; a torn last line is skipped; a bad middle line is an error", async () => {
    const files = fresh();
    assert.deepEqual(await files.readJsonl("fx/logs/none.jsonl", z.object({})), []);
    writeFileSync(join(root, "fx/logs/torn.jsonl"), '{"a":1}\r\n{"a":2}\n{"a":');
    assert.deepEqual(await files.readJsonl("fx/logs/torn.jsonl", z.object({ a: z.number() })), [{ a: 1 }, { a: 2 }]);
    writeFileSync(join(root, "fx/logs/bad.jsonl"), '{"a":1}\nnope\n{"a":2}\n');
    await assert.rejects(files.readJsonl("fx/logs/bad.jsonl", z.object({ a: z.number() })), /bad\.jsonl:2/);
  });
});

describe("list", () => {
  before(() => {
    for (const p of [
      "g/artifacts/T-001-sa/ticket.toml",
      "g/artifacts/T-002-sa/ticket.toml",
      "g/artifacts/T-002-sa/decisions/D-001-sa.toml",
      "g/x/.hidden/a.toml",
      "g/b1.md",
      "g/b2.md",
      "g/b10.md",
    ]) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), "");
    }
    writeFileSync(join(root, "g/artifacts/T-001-sa/ticket.toml.lock"), "");
  });

  test("* and ? within a segment, sorted, forward slashes", async () => {
    const files = fresh();
    assert.deepEqual(await files.list("g/artifacts/*/ticket.toml"), ["g/artifacts/T-001-sa/ticket.toml", "g/artifacts/T-002-sa/ticket.toml"]);
    assert.deepEqual(await files.list("g/b?.md"), ["g/b1.md", "g/b2.md"]);
    assert.deepEqual(await files.list("g/artifacts/T-001-sa/*"), ["g/artifacts/T-001-sa/ticket.toml"]);
  });

  test("** matches any depth, skips dot folders", async () => {
    const files = fresh();
    assert.deepEqual(await files.list("g/**/*.toml"), [
      "g/artifacts/T-001-sa/ticket.toml",
      "g/artifacts/T-002-sa/decisions/D-001-sa.toml",
      "g/artifacts/T-002-sa/ticket.toml",
    ]);
    assert.deepEqual(await files.list("g/artifacts/**/D-*.toml"), ["g/artifacts/T-002-sa/decisions/D-001-sa.toml"]);
    assert.deepEqual(await files.list("nowhere/**"), []);
  });
});

describe("path safety", () => {
  test("paths escaping the root are refused", async () => {
    const files = fresh();
    const outside = (p: Promise<unknown>) =>
      assert.rejects(p, (e: unknown) => {
        assert.ok(e instanceof PathOutsideWorkspaceError);
        assert.equal(e.rule, "path-outside-workspace");
        return true;
      });
    await outside(files.readText("../secret.txt"));
    await outside(files.writeText("fx/../../escape.md", "x"));
    await outside(files.writeText(resolve(root, "..", "abs.md"), "x"));
    await outside(files.appendJsonl("..\\up.jsonl", {}));
    await outside(files.exists("../x"));
    await outside(files.list("../*"));
    await outside(files.remove("."));
    assert.equal(existsSync(resolve(root, "..", "escape.md")), false);
  });

  test("a name that merely starts with dots is fine; absolute paths inside root are fine", async () => {
    const files = fresh();
    await files.writeText("..notes.md", "x\n");
    assert.equal(await files.readText(join(root, "..notes.md")), "x\n");
    assert.equal(await files.exists("..notes.md"), true);
  });
});
