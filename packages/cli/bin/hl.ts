#!/usr/bin/env node
// hl launcher: turn on the compile cache first, then load the CLI.
import module from "node:module";

module.enableCompileCache?.();

const [{ main }, { catalog }] = await Promise.all([import("../src/main.ts"), import("@helmlock/plugins")]);

const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
try {
  process.exitCode = await main({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    catalog,
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    tty,
  });
} catch (e) {
  process.stderr.write(`hl: internal error: ${(e as Error).stack ?? String(e)}\n`);
  process.exitCode = 1;
}
