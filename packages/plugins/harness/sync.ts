// Write (or, with check, compare) the generated host files. Line endings are compared as LF so a CRLF checkout
// is not reported stale. In a knowledge repo both harness sources are merged (system, then workspace) and the agent
// and skill layers are resolved (layers.ts): winners go to .claude/agents and .claude/skills, stamped GENERATED.
// In the delivery repo only the AGENTS.md block is generated: it is not a knowledge repo, so its own sessions get no
// knowledge-repo deny rules, hooks or copies.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HarnessFileResult } from "@helmlock/core";
import { generate } from "./generate.ts";
import {
  agentFiles,
  generatedAgent,
  isGeneratedAgent,
  isGeneratedSkill,
  plannedOutputs,
  resolveItems,
  SKILL_MARKER,
  skillFiles,
  skillMarker,
} from "./layers.ts";
import { isDeliveryRoot, loadLayers } from "./source.ts";

const lf = (s: string) => s.replace(/\r\n/g, "\n");

/** A sync result; `removed` marks a generated output whose source is gone (deleted, or would be with check). */
export type SyncResult = HarnessFileResult & { removed?: boolean };

function writeAtomic(abs: string, content: string | Buffer) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.hl-tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, abs);
}

export function syncHarness(root: string, deliveryRoot: string, opts: { check?: boolean; author?: string } = {}): SyncResult[] {
  const src = loadLayers(root, deliveryRoot);
  const agentsPath = join(root, "AGENTS.md");
  const delivery = isDeliveryRoot(root, deliveryRoot);
  const planned = delivery ? { agents: [], skills: [] } : plannedOutputs(resolveItems(root, deliveryRoot, opts.author));
  const agents = planned.agents.map((a) => ({ name: a.name, content: generatedAgent(a) }));
  let files = generate(src, { deliveryRoot, agentsMd: existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : undefined, agents });
  if (delivery) files = files.filter((f) => f.path === "AGENTS.md");
  const out: SyncResult[] = [];
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
    writeAtomic(abs, f.content);
    out.push({ path: f.path, status: "written" });
  }
  if (delivery) return out;

  const removed = (path: string, rm: () => void) => {
    if (!opts.check) rm();
    out.push({ path, status: opts.check ? "stale" : "written", removed: true });
  };
  // Generated agents whose source is gone. Hand-made files (no stamp) are never touched.
  const keepAgents = new Set(agents.map((a) => a.name));
  for (const f of agentFiles(join(root, ".claude", "agents")))
    if (!keepAgents.has(f.name) && isGeneratedAgent(f.abs)) removed(`.claude/agents/${f.name}.md`, () => rmSync(f.abs, { force: true }));

  // Skills: one result per folder; the copy is exact (extra files in a generated folder go), plus the marker.
  const skillsDir = join(root, ".claude", "skills");
  for (const s of planned.skills) {
    const dest = join(skillsDir, s.name);
    const want = new Map<string, Buffer>(skillFiles(s.abs).map((f) => [f, readFileSync(join(s.abs, f))]));
    want.set(SKILL_MARKER, Buffer.from(skillMarker(s), "utf8"));
    const have = existsSync(dest) ? skillFiles(dest) : [];
    const extra = have.filter((f) => !want.has(f));
    const changed = [...want].filter(([f, b]) => !existsSync(join(dest, f)) || !readFileSync(join(dest, f)).equals(b));
    const path = `.claude/skills/${s.name}/`;
    if (!changed.length && !extra.length) {
      out.push({ path, status: "unchanged" });
      continue;
    }
    if (opts.check) {
      out.push({ path, status: existsSync(dest) ? "stale" : "missing" });
      continue;
    }
    for (const f of extra) rmSync(join(dest, f), { force: true });
    for (const [f, b] of changed) writeAtomic(join(dest, f), b);
    out.push({ path, status: "written" });
  }
  const keepSkills = new Set(planned.skills.map((s) => s.name));
  if (existsSync(skillsDir))
    for (const e of readdirSync(skillsDir, { withFileTypes: true }))
      if (e.isDirectory() && !keepSkills.has(e.name) && isGeneratedSkill(join(skillsDir, e.name)))
        removed(`.claude/skills/${e.name}/`, () => rmSync(join(skillsDir, e.name), { recursive: true, force: true }));
  return out;
}
