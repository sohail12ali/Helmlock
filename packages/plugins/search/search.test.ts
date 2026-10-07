import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { SearchHit } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { searchJs, searchRg } from "./index.ts";

const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const seed = (root: string) => {
  put(root, "shared/wiki/carriers.md", "# Carriers\n\nUPS and FedEx use Carrier Codes from the contract.\n");
  put(root, "artifacts/T-001-sa/T-001-sa-spec.md", "Spec\nmap the carrier codes per site\n");
  put(root, "archive/T-000-sa/notes.md", "old carrier codes list\n");
  put(root, "_work/scratch.md", "carrier codes scratch\n");
  put(root, "node_modules/x/readme.md", "carrier codes in a dependency\n");
};
const paths = (hits: SearchHit[]) => [...new Set(hits.map((h) => h.path))].sort();

test("search finds text case-insensitively and skips archive/ unless asked", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    seed(ws.root);
    const res = await ws.run("search", { query: "carrier codes" });
    assert.ok(res.ok, JSON.stringify(res));
    const hits = res.data as SearchHit[];
    assert.deepEqual(paths(hits), ["artifacts/T-001-sa/T-001-sa-spec.md", "shared/wiki/carriers.md"]);
    const spec = hits.find((h) => h.path.startsWith("artifacts/"));
    assert.equal(spec?.line, 2);
    assert.equal(spec?.text, "map the carrier codes per site");

    const archived = await ws.run("search", { query: "CARRIER CODES", archived: true });
    assert.ok(archived.ok);
    assert.deepEqual(paths(archived.data as SearchHit[]), ["archive/T-000-sa/notes.md", "artifacts/T-001-sa/T-001-sa-spec.md", "shared/wiki/carriers.md"]);

    const none = await ws.run("search", { query: "no such phrase anywhere" });
    assert.ok(none.ok);
    assert.deepEqual(none.data, []);
  } finally {
    await ws.cleanup();
  }
});

test("the JS scan gives the same answer when rg is missing", async () => {
  const ws = await createTestWorkspace({ catalog });
  try {
    seed(ws.root);
    assert.equal(await searchRg(ws.root, "carrier codes", {}, "rg-missing-for-test"), undefined);
    const js = await searchJs(ws.root, "carrier codes");
    assert.deepEqual(paths(js), ["artifacts/T-001-sa/T-001-sa-spec.md", "shared/wiki/carriers.md"]);
    assert.deepEqual(paths(await searchJs(ws.root, "carrier codes", { archived: true })), [
      "archive/T-000-sa/notes.md",
      "artifacts/T-001-sa/T-001-sa-spec.md",
      "shared/wiki/carriers.md",
    ]);
    assert.equal((await searchJs(ws.root, "carrier codes", { limit: 1 })).length, 1);
  } finally {
    await ws.cleanup();
  }
});
