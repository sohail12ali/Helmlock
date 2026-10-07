import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveUi } from "./static.ts";

test("serveUi: files, client routes with file names, real 404s", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hl-ui-"));
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<html>app</html>");
    writeFileSync(join(dir, "assets", "a.js"), "x");
    assert.equal(await (await serveUi(dir, "/assets/a.js")).text(), "x");
    assert.equal(await (await serveUi(dir, "/t/T-001-sa")).text(), "<html>app</html>");
    assert.equal(await (await serveUi(dir, "/t/T-001-sa/T-001-sa-spec.md")).text(), "<html>app</html>");
    assert.equal((await serveUi(dir, "/assets/missing.js")).status, 404);
    assert.equal((await serveUi(dir, "/favicon.ico")).status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
