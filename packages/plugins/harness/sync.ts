// Write (or, with check, compare) the generated host files. Line endings are compared as LF so a CRLF checkout
// is not reported stale. In a knowledge repo both layers are merged (system, then workspace); in the delivery repo
// only the AGENTS.md block is generated: it is not a knowledge repo, so its own sessions get no knowledge-repo
// deny rules or hooks.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HarnessFileResult } from "@helmlock/core";
import { generate } from "./generate.ts";
import { isDeliveryRoot, loadLayers } from "./source.ts";

const lf = (s: string) => s.replace(/\r\n/g, "\n");

export function syncHarness(root: string, deliveryRoot: string, opts: { check?: boolean } = {}): HarnessFileResult[] {
  const src = loadLayers(root, deliveryRoot);
  const agentsPath = join(root, "AGENTS.md");
  const agentsDir = join(deliveryRoot, ".claude", "agents");
  const systemAgents =
    !isDeliveryRoot(root, deliveryRoot) && existsSync(agentsDir)
      ? readdirSync(agentsDir)
          .filter((n) => n.endsWith(".md"))
          .sort()
          .map((name) => ({ name, text: readFileSync(join(agentsDir, name), "utf8") }))
      : [];
  let files = generate(src, { deliveryRoot, agentsMd: existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : undefined, systemAgents });
  if (isDeliveryRoot(root, deliveryRoot)) files = files.filter((f) => f.path === "AGENTS.md");
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
