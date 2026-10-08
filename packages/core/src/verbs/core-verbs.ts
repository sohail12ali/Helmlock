// Core verbs (S1): where, doctor, help agent, config show. Inputs use liteObject so zod stays off the startup path.
import type { Context, MountResult } from "../contracts/kernel.ts";
import { ok } from "../contracts/verbs.ts";
import { type CheckResult, runChecks } from "./doctor.ts";
import { liteObject } from "./input.ts";

/** What core verbs need from the runtime beyond the context. */
export interface CoreVerbHost {
  configError(): Error | undefined;
  workspaceRaw(): Promise<Record<string, unknown> | undefined>;
  mountAll(): Promise<MountResult[]>;
  pending(): { id: string; waitingFor: string[] }[];
  /** Cycles found in plugin.toml `requires` while ordering mounts. */
  cycles(): string[];
  env: Record<string, string | undefined>;
}

export const CORE_VERBS = ["where", "doctor", "help agent", "config show"] as const;

export const AGENT_CONTRACT = `hl agent contract

Rule: state through hl, prose directly.
  - State lives in TOML and JSONL. Change it only with \`hl <noun> <verb>\`; never edit *.toml or *.jsonl by hand.
  - Prose (spec, plan, notes, wiki) is markdown: edit it directly; the validate hook checks it.
  - Never read generated HTML or generated notes.
  - If hl is missing or broken, stop and say so. Do not edit state files instead.

Start every task with: hl context <ticket> --json

Most used verbs:
  hl context <T> --json                  digest: stage, blockers, open questions, next steps, files
  hl ticket show <T> --json              one ticket
  hl ticket list --stage <s> --json      tickets in a stage
  hl ticket move <T> <stage>             exits 2 when a gate blocks; read the reasons
  hl ticket block <T> --by "..." --next "..."
  hl decision add <T> "<title>" --chosen "..." --why "..."
  hl question add <T> "<text>" [--blocking]
  hl task set <T> <task-id> --status done
  hl log-work <T> "<one sentence>" --category Development
  hl search "<query>" --json

Exit codes:
  0  ok
  1  error: the message names the rule, the file and the fix; correct and retry once
  2  blocked by a gate or guard: do not retry blindly; resolve the reason or ask a person

Flags: every read verb takes --json (prints {"ok":true,"data":...} or {"ok":false,"code":n,"error":{rule,message,file,fix}}).
Every write verb takes --dry-run. Prompts never appear when piped, so missing arguments fail with exit 1.
Unknown command? hl prints "did you mean". Full list: hl --help. One verb: hl <noun> <verb> --help.`;

const MOST_USED = ["context", "ticket show", "ticket list", "ticket move", "ticket block", "decision add", "question add", "task set", "log-work", "search"];

const ICON: Record<CheckResult["status"], string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };

export function registerCoreVerbs(ctx: Context, host: CoreVerbHost): void {
  const verbs = ctx.get("verbs");

  verbs.register({
    id: "where",
    summary: "Show the resolved knowledge repo, delivery repo, folders and author, and where each came from.",
    examples: ["hl where", "hl where --json"],
    input: liteObject({}),
    writes: false,
    async run(v) {
      const w = v.ctx.get("workspace");
      const data = {
        workspace: w.root,
        name: w.name,
        delivery: w.deliveryRoot,
        code_workspace: w.codeWorkspaceFile ?? null,
        author: w.author ?? null,
        folders: w.folders,
        sources: w.sources,
      };
      const text = [
        `workspace  ${w.root}  (${w.sources.root})`,
        `delivery   ${w.deliveryRoot}  (${w.sources.deliveryRoot})`,
        `author     ${w.author ?? "-"}  (${w.sources.author})`,
        ...w.folders.map((f) => `folder     ${f.name.padEnd(12)} ${f.layer.padEnd(9)} ${f.path}`),
      ].join("\n");
      return ok(data, text);
    },
  });

  verbs.register({
    id: "doctor",
    summary: "Check the setup: node, tools on PATH, workspace, workspace.toml, plugins, author. --repair applies safe fixes only.",
    examples: ["hl doctor", "hl doctor --json", "hl doctor --repair"],
    input: liteObject({ repair: "boolean" }),
    writes: false,
    async run(v, input) {
      const checks = await runChecks({
        ctx: v.ctx,
        env: host.env,
        nodeVersion: process.versions.node,
        configError: host.configError(),
        workspaceRaw: host.workspaceRaw,
        mountAll: host.mountAll,
        pending: host.pending,
        cycles: host.cycles,
        dryRun: v.dryRun,
      });
      const repaired: string[] = [];
      if ((input as { repair?: boolean }).repair)
        for (const c of checks)
          if (c.canRepair && c.repair && c.status !== "pass") {
            await c.repair();
            repaired.push(c.name);
            if (!v.dryRun) {
              c.status = "pass";
              c.message = `repaired (${c.message})`;
            }
          }
      const summary = { pass: 0, warn: 0, fail: 0 };
      for (const c of checks) summary[c.status]++;
      const data = {
        checks: checks.map(({ repair: _r, ...c }) => c),
        summary,
        repaired,
      };
      const text = [
        ...checks.map(
          (c) => `${ICON[c.status]}  ${c.name.padEnd(15)} ${c.message}${c.status !== "pass" && c.repairHint ? `\n      fix: ${c.repairHint}` : ""}`,
        ),
        "",
        `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed${repaired.length ? `; repaired: ${repaired.join(", ")}${v.dryRun ? " (dry run)" : ""}` : ""}`,
      ].join("\n");
      return ok(data, text);
    },
  });

  verbs.register({
    id: "help agent",
    summary: "Print the contract agents follow when they use hl.",
    examples: ["hl help agent", "hl help agent --json"],
    input: liteObject({}),
    writes: false,
    async run() {
      return ok(
        {
          rule: "state through hl, prose directly",
          verbs: MOST_USED,
          exit_codes: { 0: "ok", 1: "error (rule, file, fix in the message)", 2: "blocked by a gate or guard" },
          json: '--json prints {"ok":true,"data":...} or {"ok":false,"code":n,"error":{...}}',
          dry_run: "every write verb takes --dry-run",
        },
        AGENT_CONTRACT,
      );
    },
  });

  verbs.register({
    id: "config show",
    summary: "Show the composed plugin rows (bundles, workspace.toml, workspace.local.toml, flags) and the layer each came from.",
    examples: ["hl config show", "hl config show --json", "hl config show --disable harness"],
    input: liteObject({}),
    writes: false,
    async run(v) {
      const err = host.configError();
      if (err) throw err;
      const rows = v.ctx.get("config").rows();
      const text = rows
        .map((r) => {
          const cfg = r.config && Object.keys(r.config).length ? `  ${JSON.stringify(r.config)}` : "";
          const use = r.use === r.id ? "" : ` -> ${r.use}`;
          return `${(r.id + use).padEnd(28)} ${(r.disabled ? "disabled" : "on").padEnd(9)} ${r.source.layer}${r.source.file && r.source.layer !== "flags" ? ` (${r.source.file})` : ""}${cfg}`;
        })
        .join("\n");
      return ok({ bundles: v.ctx.get("config").workspace.bundles, rows }, text);
    },
  });
}
