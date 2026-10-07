// Write (or, with check, compare) the generated host files. Line endings are compared as LF so a CRLF checkout
// is not reported stale.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HarnessFileResult } from "@helmlock/core";
import { generate } from "./generate.ts";
import { loadSource } from "./source.ts";

const lf = (s: string) => s.replace(/\r\n/g, "\n");

export function syncHarness(root: string, deliveryRoot: string, opts: { check?: boolean } = {}): HarnessFileResult[] {
  const src = loadSource(root);
  const agentsPath = join(root, "AGENTS.md");
  const files = generate(src, { deliveryRoot, agentsMd: existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : undefined });
  const out: HarnessFileResult[] = [];
  for (const f of files) {
    const abs = join(root, f.path);
    const current = existsSync(abs) ? lf(readFileSync(abs, "utf8")) : undefined;
    if (current === f.content) {
      out.push({ path: f.path, status: "unchanged" });
      continue;
    }
    if (opts.check) {
      out.push({ path: f.path, status: current === undefined ? "missing" : "stale" });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.hl-tmp-${process.pid}`;
    writeFileSync(tmp, f.content, "utf8");
    renameSync(tmp, abs);
    out.push({ path: f.path, status: "written" });
  }
  return out;
}
