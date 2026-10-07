import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { STRIPPED } from "./share.ts";
import { type ChatLine, createChatStore, type SharedSummary } from "./store.ts";

const ID = "ch-20261007-142501-a1b2";
const lines: ChatLine[] = [
  { t: "meta", id: ID, title: "New chat", model: "fake/m1", channel: "console", created: "2026-10-07T14:25:01.000Z", responsible: "sam" },
  { t: "msg", m: { id: "m1", role: "user", text: "what is in my notes?", ts: "2026-10-07T14:25:02.000Z" } },
  {
    t: "msg",
    m: { id: "m2", role: "assistant", text: "", ts: "2026-10-07T14:25:03.000Z" },
    calls: [{ id: "c1", name: "file_read", arguments: '{"path":"_work/secret.md"}' }],
  },
  {
    t: "msg",
    call_id: "c1",
    m: {
      id: "m3",
      role: "tool",
      text: "",
      ts: "2026-10-07T14:25:04.000Z",
      tool: { name: "file_read", input: { path: "_work/secret.md" }, status: "done", result: "the vault code is 1234" },
    },
  },
  { t: "msg", m: { id: "m4", role: "assistant", text: "Your notes mention a code.", ts: "2026-10-07T14:25:05.000Z" } },
];

test("chat share copies a chat to people/<slug>/chats/, drops file_read results and marks the local chat shared", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    mkdirSync(join(ws.root, "chats"), { recursive: true });
    writeFileSync(join(ws.root, "chats", `${ID}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);

    const dry = await ws.run("chat share", { id: ID }, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.equal(existsSync(join(ws.root, "people/sam/chats", `${ID}.jsonl`)), false);

    const r = await ws.run("chat share", { id: ID, title: "Notes question" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.text ?? "", /1 file_read result left out/);
    const copy = readFileSync(join(ws.root, "people/sam/chats", `${ID}.jsonl`), "utf8");
    assert.doesNotMatch(copy, /1234/);
    assert.match(copy, new RegExp(STRIPPED.replace(/[[\]]/g, "\\$&")));
    assert.match(copy, /Your notes mention a code/);
    assert.match(copy, /Notes question/);

    const store = createChatStore(ws.runtime.ctx.get("files"));
    const summary = (await store.load(ID)).summary as SharedSummary;
    assert.equal(summary.shared, true);
    assert.equal(summary.responsible, "sam");
    assert.equal(summary.title, "Notes question");
    assert.equal(((await store.list())[0] as SharedSummary).shared, true);
    // the local chat keeps the full result
    assert.match(readFileSync(join(ws.root, "chats", `${ID}.jsonl`), "utf8"), /1234/);

    const bad = await ws.run("chat share", { id: "ch-20990101-000000-zzzz" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.rule, "not-found");
  } finally {
    await ws.cleanup();
  }
});

test("a new chat records who is responsible (author.local) and that credentials are this machine's", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const store = createChatStore(ws.runtime.ctx.get("files"));
    const c = await store.create({ model: "fake/m1", channel: "console", responsible: "sam" });
    const head = JSON.parse(readFileSync(join(ws.root, "chats", `${c.id}.jsonl`), "utf8").split("\n")[0] as string);
    assert.equal(head.responsible, "sam");
    assert.equal(head.credentials, "this machine");
    assert.equal((c as SharedSummary).responsible, "sam");
  } finally {
    await ws.cleanup();
  }
});
