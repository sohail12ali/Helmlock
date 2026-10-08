import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ApiResponse, PeopleView, TodoItem } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { createApp } from "./app.ts";

const HEADERS = { "content-type": "application/json", "x-helmlock-request": "1" };

test("GET /people: me from author.local, the roster with git spellings, unclaimed git authors", async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  try {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Stranger",
      GIT_AUTHOR_EMAIL: "who@example.org",
      GIT_COMMITTER_NAME: "Stranger",
      GIT_COMMITTER_EMAIL: "who@example.org",
    };
    const git = (args: string[]) => assert.equal(spawnSync("git", args, { cwd: ws.root, env, windowsHide: true }).status, 0);
    git(["init", "-q"]);
    writeFileSync(join(ws.root, "a.txt"), "a");
    git(["add", "a.txt"]);
    git(["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "a"]);

    const app = createApp(ws.runtime, { log: () => {} });
    const add = await app.request("/api/v1/verbs/people/add", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ input: { id: "ann", name: "Ann Lee", initials: "al", git: ["Ann L"] } }),
    });
    assert.equal(add.status, 200, await add.clone().text());

    const res = await app.request("/api/v1/people");
    assert.equal(res.status, 200);
    const view = ((await res.json()) as ApiResponse<PeopleView> & { data: PeopleView }).data;
    assert.deepEqual(view.me, { id: "sam", name: "Sam Abbott", initials: "sa", email: "sam@example.com" });
    assert.deepEqual(
      view.people.map((p) => [p.id, p.git]),
      [
        ["sam", []],
        ["ann", ["Ann L"]],
      ],
    );
    assert.deepEqual(view.unknown_git, [{ name: "Stranger", email: "who@example.org", commits: 1 }]);

    // todos carry their scope; ?scope= filters
    const t = await app.request("/api/v1/verbs/todo/add", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ input: { text: "Mine", scope: "private" } }),
    });
    assert.equal(t.status, 200);
    const list = ((await (await app.request("/api/v1/todos")).json()) as { data: TodoItem[] }).data;
    assert.deepEqual(
      list.map((i) => [i.id, i.scope]),
      [
        ["TD-001-sa", "team"],
        ["TD-002-sa", "private"],
      ],
    );
    const priv = ((await (await app.request("/api/v1/todos?scope=private")).json()) as { data: TodoItem[] }).data;
    assert.deepEqual(
      priv.map((i) => i.id),
      ["TD-002-sa"],
    );
    assert.equal((await app.request("/api/v1/todos?scope=nope")).status, 400);
  } finally {
    await ws.cleanup();
  }
});
