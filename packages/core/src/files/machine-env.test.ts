import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveEnv, machineSecret, parseEnvText, readMachineEnv, SecretError, secretSource, setMachineSecret } from "./machine-env.ts";

function tmp(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "hl-env-"));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("parseEnvText: quotes, comments, blank lines, CRLF, export, inline comments", () => {
  const text = '﻿# top\r\nA=1\r\n\r\nB="two words"\r\nC=\'single # kept\'\r\nexport D=four # note\r\n  E = spaced  \r\nbad line\r\nF="esc \\"q\\""\r\n';
  assert.deepEqual(parseEnvText(text), { A: "1", B: "two words", C: "single # kept", D: "four", E: "spaced", F: 'esc "q"' });
});

test("effectiveEnv: .env fills unset or empty names; the process env wins; read fresh every call", () => {
  const t = tmp();
  try {
    assert.deepEqual(readMachineEnv(t.root), {});
    writeFileSync(join(t.root, ".env"), "TOKEN=from-file\nEMPTY=filled\nBOTH=file\n");
    const env = effectiveEnv(t.root, { BOTH: "process", EMPTY: "" });
    assert.equal(env.TOKEN, "from-file");
    assert.equal(env.EMPTY, "filled");
    assert.equal(env.BOTH, "process");
    assert.equal(secretSource(t.root, { BOTH: "process" }, "BOTH"), "environment");
    assert.equal(secretSource(t.root, {}, "TOKEN"), ".env");
    assert.equal(secretSource(t.root, {}, "NOPE"), undefined);
    writeFileSync(join(t.root, ".env"), "TOKEN=changed\n");
    assert.equal(machineSecret(t.root, "TOKEN", {}), "changed", "no cache: the new value is seen at once");
  } finally {
    t.done();
  }
});

test("setMachineSecret: keeps other lines and comments, replaces an existing name, quotes when needed", async () => {
  const t = tmp();
  try {
    writeFileSync(join(t.root, ".env"), "# my keys\r\nOTHER=keep\r\nHL_TOKEN=old\r\n");
    writeFileSync(join(t.root, ".gitignore"), "node_modules/\n.env\n");
    const r = await setMachineSecret(t.root, "HL_TOKEN", "123:abc");
    assert.deepEqual(r, { name: "HL_TOKEN", file: ".env", added: false, gitignoreUpdated: false });
    assert.equal(readFileSync(join(t.root, ".env"), "utf8"), "# my keys\r\nOTHER=keep\r\nHL_TOKEN=123:abc\r\n");
    const r2 = await setMachineSecret(t.root, "NEW_KEY", 'sk with "space"');
    assert.equal(r2.added, true);
    assert.equal(readMachineEnv(t.root).NEW_KEY, 'sk with "space"');
    assert.equal(readMachineEnv(t.root).OTHER, "keep");
    assert.equal(existsSync(join(t.root, ".env.lock")), false);
  } finally {
    t.done();
  }
});

test("setMachineSecret: appends .env to .gitignore when it is missing (once)", async () => {
  const t = tmp();
  try {
    writeFileSync(join(t.root, ".gitignore"), "node_modules/");
    const r = await setMachineSecret(t.root, "A_KEY", "v");
    assert.equal(r.gitignoreUpdated, true);
    assert.match(readFileSync(join(t.root, ".gitignore"), "utf8"), /^node_modules\/\n# .*\n\.env\n$/);
    assert.equal((await setMachineSecret(t.root, "A_KEY", "w")).gitignoreUpdated, false);
    const u = tmp();
    try {
      assert.equal((await setMachineSecret(u.root, "A_KEY", "v")).gitignoreUpdated, true, "no .gitignore at all: one is created");
      assert.match(readFileSync(join(u.root, ".gitignore"), "utf8"), /^# .*\n\.env\n$/);
    } finally {
      u.done();
    }
  } finally {
    t.done();
  }
});

test("setMachineSecret: refuses bad names and empty or multi-line values; dry run writes nothing", async () => {
  const t = tmp();
  try {
    for (const [name, value, rule] of [
      ["lower", "v", "bad-secret-name"],
      ["1ABC", "v", "bad-secret-name"],
      ["123:AAH-token", "v", "bad-secret-name"],
      ["OK", "", "bad-secret-value"],
      ["OK", "  ", "bad-secret-value"],
      ["OK", "a\nb", "bad-secret-value"],
    ] as const) {
      await assert.rejects(setMachineSecret(t.root, name, value), (e: unknown) => e instanceof SecretError && e.rule === rule && !e.message.includes("a\nb"));
    }
    const r = await setMachineSecret(t.root, "OK", "v", { dryRun: true });
    assert.equal(r.added, true);
    assert.equal(existsSync(join(t.root, ".env")), false);
    assert.equal(existsSync(join(t.root, ".gitignore")), false);
  } finally {
    t.done();
  }
});
