import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Person } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";
import { claimant, gitAuthors, unknownAuthors } from "./people.ts";

const people = (root: string) => (parse(readFileSync(join(root, "people.toml"), "utf8")) as { person: Person[] }).person;

test("people add writes people.toml and refuses duplicates; people claim adds a spelling", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const added = await ws.run("people add", { id: "ann", name: "Ann Lee", initials: "al", email: "ann@example.com", git: "Ann Lee" });
    assert.ok(added.ok, JSON.stringify(added));
    let rows = people(ws.root);
    assert.deepEqual(
      rows.map((p) => p.id),
      ["sam", "ann"],
    );
    assert.deepEqual(rows[1]?.git, ["Ann Lee"]);

    const dry = await ws.run("people add", { id: "bob", name: "Bob", initials: "bo" }, { dryRun: true });
    assert.ok(dry.ok);
    assert.equal(people(ws.root).length, 2);

    for (const [input, rule] of [
      [{ id: "ann", name: "Ann Again", initials: "aa" }, "duplicate"],
      [{ id: "al2", name: "Al", initials: "al" }, "duplicate"],
      [{ id: "bob", name: "Bob", initials: "bo", git: ["Ann Lee"] }, "claimed"],
    ] as const) {
      const r = await ws.run("people add", input);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.rule, rule);
    }

    const claim = await ws.run("people claim", { id: "sam", git: "Sam A." });
    assert.ok(claim.ok);
    rows = people(ws.root);
    assert.deepEqual(rows[0]?.git, ["Sam A."]);
    const again = await ws.run("people claim", { id: "sam", git: "sam a." });
    assert.ok(again.ok, "claiming a spelling twice is a no-op");
    assert.deepEqual(people(ws.root)[0]?.git, ["Sam A."]);
    const taken = await ws.run("people claim", { id: "ann", git: "Sam A." });
    assert.equal(taken.ok, false);
    if (!taken.ok) assert.equal(taken.error.rule, "claimed");
    const nobody = await ws.run("people claim", { id: "zed", git: "Zed" });
    assert.equal(nobody.ok, false);
    if (!nobody.ok) assert.equal(nobody.error.rule, "not-found");

    // the author is still read from author.local only
    assert.equal((await ws.runtime.ctx.get("roster").current()).id, "sam");
  } finally {
    await ws.cleanup();
  }
});

test("people unknown lists git authors nobody claims, with commit counts", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    const git = (args: string[], name: string, email: string) => {
      const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
      const r = spawnSync("git", args, { cwd: ws.root, env, encoding: "utf8", windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
    };
    git(["init", "-q"], "x", "x@x");
    const commit = (n: number, name: string, email: string) => {
      writeFileSync(join(ws.root, `f${n}.txt`), String(n));
      git(["add", "."], name, email);
      git(["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", `c${n}`], name, email);
    };
    commit(1, "Sam Abbott", "sam@example.com"); // claimed by sam's email
    commit(2, "Laptop Sam", "sam@laptop.local");
    commit(3, "Laptop Sam", "sam@laptop.local");
    commit(4, "Stranger", "who@example.org");

    assert.deepEqual(gitAuthors(ws.root)[0], { name: "Laptop Sam", email: "sam@laptop.local", commits: 2 });
    const r = await ws.run("people unknown", {});
    assert.ok(r.ok);
    assert.deepEqual(r.data, [
      { name: "Laptop Sam", email: "sam@laptop.local", commits: 2 },
      { name: "Stranger", email: "who@example.org", commits: 1 },
    ]);
    assert.ok((await ws.run("people claim", { id: "sam", git: "sam@laptop.local" })).ok);
    const after = await ws.run("people unknown", {});
    assert.deepEqual(after.data, [{ name: "Stranger", email: "who@example.org", commits: 1 }]);
  } finally {
    await ws.cleanup();
  }
});

test("claimant and unknownAuthors match spellings case-insensitively and infer nothing else", () => {
  const roster: Person[] = [{ id: "sam", name: "Sam Abbott", initials: "sa", email: "sam@example.com", git: ["Sam A."] }];
  assert.equal(claimant(roster, "SAM a.")?.id, "sam");
  assert.equal(claimant(roster, "Sam@Example.com")?.id, "sam");
  assert.equal(claimant(roster, "Sam Abbott"), undefined, "the display name is not a claim");
  assert.equal(claimant(roster, ""), undefined);
  assert.deepEqual(unknownAuthors(roster, [{ name: "Sam Abbott", email: "other@x", commits: 1 }]), [{ name: "Sam Abbott", email: "other@x", commits: 1 }]);
  assert.equal(gitAuthors(join(tmpdir(), "hl-no-such-folder")).length, 0, "no repo, no authors");
});
