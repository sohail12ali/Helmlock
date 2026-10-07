import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { SearchHit } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { checkDigest } from "./digest.ts";
import { localDate } from "./lifecycle.ts";

const validDigest = (id: string, closed?: string) => `---
type: closure
ticket: ${id}
${closed ? `closed: ${closed}\n` : ""}---

# ${id} closure digest

## Outcome

Shipped the opening hours page so customers see when each store is open.

## Decisions

(none)

## Key files and links

- [[${id}-spec]]

## Caveats

(none)

## Follow-ups

(none)
`;

const write = (ws: TestWorkspace, rel: string, text: string) => {
  mkdirSync(join(ws.root, rel, ".."), { recursive: true });
  writeFileSync(join(ws.root, rel), text);
};
const setStage = (ws: TestWorkspace, id: string, stage: string) => {
  const p = join(ws.root, `artifacts/${id}/ticket.toml`);
  writeFileSync(p, readFileSync(p, "utf8").replace(/^stage = ".*"$/m, `stage = "${stage}"`));
};

test("checkDigest: sections, placeholders and size", () => {
  assert.equal(checkDigest(validDigest("T-005-sa")).ok, true);
  const missing = checkDigest(validDigest("T-005-sa").replace("## Caveats", "## Notes"));
  assert.deepEqual(
    missing.problems.map((p) => p.rule),
    ["digest-section-missing"],
  );
  const empty = checkDigest(validDigest("T-005-sa").replace("(none)\n\n## Key", "\n## Key"));
  assert.equal(empty.problems[0]?.rule, "digest-section-empty");
  assert.equal(checkDigest(validDigest("{T}")).problems.at(-1)?.rule, "digest-placeholder");
  const long = checkDigest(validDigest("T-005-sa").replace("Shipped the", `${"word ".repeat(500)}Shipped the`));
  assert.equal(long.problems[0]?.rule, "digest-too-long");
  assert.ok(long.words > 500);
});

test("ticket close, retention, archive, search and restore", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const id = "T-005-sa";
    const digest = `artifacts/${id}/${id}-digest.md`;
    setStage(ws, id, "verify");

    const none = await ws.run("ticket close", { id });
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.error.rule, "digest-missing");

    write(ws, digest, validDigest(id).replace("## Follow-ups", "## Later"));
    const bad = await ws.run("ticket close", { id });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.code, 1);
      assert.equal(bad.error.rule, "digest-section-missing");
    }
    write(ws, digest, validDigest(id).replace("Shipped the", `${"long ".repeat(460)}Shipped the`));
    const big = await ws.run("ticket close", { id });
    assert.equal(big.ok, false);
    if (!big.ok) assert.equal(big.error.rule, "digest-too-long");
    assert.match(readFileSync(join(ws.root, `artifacts/${id}/ticket.toml`), "utf8"), /stage = "verify"/, "nothing moved while invalid");

    write(ws, digest, validDigest(id, "2020-01-01"));
    const dry = await ws.run("ticket close", { id }, { dryRun: true });
    assert.ok(dry.ok);
    assert.match(readFileSync(join(ws.root, `artifacts/${id}/ticket.toml`), "utf8"), /stage = "verify"/);
    const closed = await ws.run("ticket close", { id });
    assert.ok(closed.ok, JSON.stringify(closed));
    assert.match(readFileSync(join(ws.root, `artifacts/${id}/ticket.toml`), "utf8"), /stage = "done"/);
    const again = await ws.run("ticket close", { id });
    assert.ok(again.ok);
    assert.match(again.text ?? "", /already closed/);

    // The workflow still decides: spec -> done is not a transition (exit 2).
    write(ws, "artifacts/T-001-sa/T-001-sa-digest.md", validDigest("T-001-sa"));
    const gated = await ws.run("ticket close", { id: "T-001-sa" });
    assert.equal(gated.ok, false);
    if (!gated.ok) assert.equal(gated.code, 2);

    // Retention: closed 2020-01-01 is past the default 30 days.
    const sug = await ws.run("retention suggest", {});
    assert.ok(sug.ok);
    assert.deepEqual(
      (sug.data as { items: { ticket: string }[] }).items.map((x) => x.ticket),
      [id],
    );
    const session = await ws.run("context", { session: true });
    assert.ok(session.ok);
    assert.match(session.text ?? "", /Archive eligible .*T-005-sa/);

    // Archive: refuses an open ticket, dry run writes nothing, then moves with a manifest.
    const open = await ws.run("ticket archive", { id: "T-001-sa" });
    assert.equal(open.ok, false);
    if (!open.ok) assert.equal(open.error.rule, "not-closed");
    write(ws, `artifacts/${id}/${id}-notes.md`, "# Notes\n\nThe zebrafish rollout plan.\n");
    write(ws, `artifacts/${id}/_work/draft.md`, "draft\n");
    const ad = await ws.run("ticket archive", { id }, { dryRun: true });
    assert.ok(ad.ok);
    assert.ok(existsSync(join(ws.root, `artifacts/${id}`)));
    assert.equal(existsSync(join(ws.root, `shared/digests/${id}.md`)), false);

    const a = await ws.run("ticket archive", { id });
    assert.ok(a.ok, JSON.stringify(a));
    const month = localDate(new Date()).slice(0, 7);
    const dest = join(ws.root, "archive", month, id);
    assert.equal(existsSync(join(ws.root, `artifacts/${id}`)), false);
    assert.ok(existsSync(join(dest, "ticket.toml")));
    assert.ok(existsSync(join(dest, `${id}-digest.md`)));
    assert.ok(existsSync(join(dest, "_work/draft.md")));
    const manifest = readFileSync(join(dest, "manifest.sha256"), "utf8");
    assert.match(manifest, /^[0-9a-f]{64} {2}ticket\.toml$/m);
    assert.match(manifest, /^[0-9a-f]{64} {2}_work\/draft\.md$/m);
    assert.equal(readFileSync(join(ws.root, `shared/digests/${id}.md`), "utf8"), validDigest(id, "2020-01-01"));
    assert.equal(
      (await ws.runtime.ctx.get("tickets").list()).some((t) => t.ticket.id === id),
      false,
    );

    const hidden = await ws.run("search", { query: "zebrafish" });
    assert.ok(hidden.ok);
    assert.deepEqual(hidden.data, []);
    const shown = await ws.run("search", { query: "zebrafish", archived: true });
    assert.ok(shown.ok);
    assert.ok((shown.data as SearchHit[]).some((h) => h.path.startsWith(`archive/${month}/${id}/`)));

    const twice = await ws.run("ticket archive", { id: "T-002-sa" });
    assert.equal(twice.ok, false);

    // Restore: a changed file is refused; the untouched archive comes back.
    const notes = join(dest, `${id}-notes.md`);
    writeFileSync(notes, "tampered\n");
    const refused = await ws.run("ticket restore", { id });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.rule, "manifest-mismatch");
    writeFileSync(notes, "# Notes\n\nThe zebrafish rollout plan.\n");
    const r = await ws.run("ticket restore", { id });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(existsSync(join(ws.root, `artifacts/${id}/ticket.toml`)));
    assert.ok(existsSync(join(ws.root, `artifacts/${id}/_work/draft.md`)));
    assert.equal(existsSync(join(ws.root, `artifacts/${id}/manifest.sha256`)), false);
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(join(ws.root, `shared/digests/${id}.md`)), false);
    assert.deepEqual(readdirSync(join(ws.root, "archive", month)), []);
    assert.equal((await ws.runtime.ctx.get("tickets").get(id)).ticket.stage, "done");

    const notArchived = await ws.run("ticket restore", { id });
    assert.equal(notArchived.ok, false);
    if (!notArchived.ok) assert.equal(notArchived.error.rule, "not-archived");
  } finally {
    await ws.cleanup();
  }
});
