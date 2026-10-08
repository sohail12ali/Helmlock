import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DELIVERY_ROOT, FIXTURES } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { readRecent } from "@helmlock/plugins/scaffold/recent.ts";
import { parseServeArgs, serve } from "./serve.ts";

test("parseServeArgs", () => {
  assert.deepEqual(parseServeArgs(["serve"]), { port: 4317, open: false });
  assert.deepEqual(parseServeArgs(["serve", "--port", "4400", "--open"]), { port: 4400, open: true });
  assert.deepEqual(parseServeArgs(["serve", "--port=0"]), { port: 0, open: false });
  assert.ok("error" in parseServeArgs(["serve", "--port", "x"]));
  assert.ok("error" in parseServeArgs(["serve", "--nope"]));
});

test("hl serve starts, answers, and shuts down cleanly", async () => {
  const root = mkdtempSync(join(tmpdir(), "hl-serve-"));
  cpSync(join(FIXTURES, "ws-demo"), root, { recursive: true });
  let stdout = "";
  let stop!: () => void;
  const stopped = new Promise<void>((r) => {
    stop = r;
  });
  try {
    const io = {
      argv: [],
      cwd: root,
      env: { HL_DELIVERY: DELIVERY_ROOT, HL_USER_HOME: join(root, ".home") },
      catalog,
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
      tty: false,
    };
    const running = serve(io, ["serve", "--port", "0"], true, { stdout: io.stdout, stderr: io.stderr, color: false }, stopped);
    while (!stdout.includes("\n")) await new Promise((r) => setTimeout(r, 20));
    const started = JSON.parse(stdout) as { ok: boolean; data: { url: string; port: number } };
    assert.equal(started.ok, true);
    const res = await fetch(`${started.data.url}api/v1/board`);
    assert.equal(res.status, 200);
    // hl serve records this center in the per-user recent list (the console switcher reads it).
    const recent = readRecent(join(root, ".home"));
    assert.deepEqual(
      recent.map((c) => [c.name, c.port]),
      [["Test", started.data.port]],
    );
    stop();
    assert.equal(await running, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
