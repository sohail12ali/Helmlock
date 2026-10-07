// Harness plugin: `hl harness sync [--check]` generates both hosts' config from harness/harness.toml;
// `hl harness lint` checks skills, agents, references and hooks.
import { resolve } from "node:path";
import type { HarnessService, PluginModule, VerbDef, WorkspaceInfo } from "@helmlock/core";
import { fail, ok } from "@helmlock/core";
import { z } from "zod";
import { HELMLOCK_LINT, lintHarness } from "./lint.ts";
import { hasSource, loadSource } from "./source.ts";
import { syncHarness } from "./sync.ts";

/** The sync root: --root, else the knowledge repo when it holds harness/harness.toml, else the delivery repo. */
export function harnessRoot(ws: WorkspaceInfo, root?: string): string {
  if (root) return resolve(ws.root, root);
  return hasSource(ws.root) ? ws.root : ws.deliveryRoot;
}

export function createHarnessService(ws: WorkspaceInfo): HarnessService {
  return {
    async sync(opts = {}) {
      return syncHarness(harnessRoot(ws, opts.root), ws.deliveryRoot, { check: opts.check });
    },
    async lint(opts = {}) {
      const root = harnessRoot(ws, opts.root);
      // harness.toml [lint] not_skills: folders under .claude/skills that are repo tools, not shipped skills.
      const extra = hasSource(root) ? ((loadSource(root).toml as { lint?: { not_skills?: string[] } }).lint?.not_skills ?? []) : [];
      return lintHarness(root, { notSkills: [...HELMLOCK_LINT.notSkills, ...extra] });
    },
  };
}

const SyncInput = z.object({ check: z.boolean().default(false), root: z.string().optional() });
const LintInput = z.object({ root: z.string().optional() });

const plugin: PluginModule = {
  name: "harness",
  requires: ["files", "verbs", "workspace"],
  apply(ctx) {
    const ws = ctx.get("workspace");
    const svc = createHarnessService(ws);
    ctx.provide("harness", svc);
    const verbs = ctx.get("verbs");
    const sync: VerbDef<typeof SyncInput> = {
      id: "harness sync",
      summary: "Generate .claude/settings.json, .cursor/*, .cursorignore and the AGENTS.md block from harness/harness.toml.",
      examples: ["hl harness sync", "hl harness sync --check", "hl harness sync --root ../helmlock"],
      input: SyncInput,
      writes: true,
      async run(v, input) {
        const root = harnessRoot(ws, input.root);
        const check = input.check || v.dryRun;
        const files = await svc.sync({ check, root });
        const text = files.map((f) => `${f.status.padEnd(9)} ${f.path}`).join("\n");
        const bad = files.filter((f) => f.status === "stale" || f.status === "missing");
        if (input.check && bad.length)
          return fail("harness-stale", `${bad.length} generated file(s) out of date:\n${text}`, { file: "harness/harness.toml", fix: "run `hl harness sync`" });
        return ok({ root, files }, `${text}\n${check ? "checked" : "synced"} ${root}`);
      },
    };
    const lint: VerbDef<typeof LintInput> = {
      id: "harness lint",
      summary: "Check skills, agents, backticked paths and /commands, and hook scripts (errors fail; orphan skills warn).",
      examples: ["hl harness lint", "hl harness lint --json"],
      input: LintInput,
      writes: false,
      async run(_v, input) {
        const findings = await svc.lint({ root: input.root });
        const errors = findings.filter((f) => f.level === "error");
        const text = findings.map((f) => `${f.level === "error" ? "ERROR" : "WARN "}  ${f.file}: ${f.message}`).join("\n");
        if (errors.length) return fail("harness-lint", `${errors.length} error(s), ${findings.length - errors.length} warning(s)\n${text}`);
        return ok({ findings }, `${text ? `${text}\n` : ""}${findings.length} warning(s), no errors`);
      },
    };
    for (const d of [sync, lint]) {
      const off = verbs.register(d as unknown as VerbDef);
      void ctx.effect(() => off);
    }
  },
};

export default plugin;
