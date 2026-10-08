// validate (stream S3): ticket folder checks driven by ticket-layout.toml. Provides `validate` and the `validate` verb.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding, fail, ok, type PluginModule, type ValidateService, type VerbDef } from "@helmlock/core";
import { parse } from "smol-toml";
import { z } from "zod";
import { createValidator, type Layout } from "./checks.ts";

/** Stage order when no workflow plugin is mounted. */
const DEFAULT_STAGES = ["backlog", "spec", "plan", "build", "verify", "done"];

export function loadLayout(file = join(import.meta.dirname, "ticket-layout.toml")): Layout {
  return parse(readFileSync(file, "utf8")) as unknown as Layout;
}

export function formatFindings(list: Finding[]): string {
  if (!list.length) return "ok: no findings";
  return list
    .map((f) => `${f.level === "error" ? "ERROR" : "warn "} ${f.rule}  ${f.file ?? ""}\n      ${f.message}${f.fix ? `\n      fix: ${f.fix}` : ""}`)
    .join("\n");
}

const plugin: PluginModule = {
  name: "validate",
  requires: ["files", "verbs"],
  async apply(ctx) {
    const layout = loadLayout();
    const v = createValidator({
      root: ctx.get("files").root,
      layout,
      stages: () =>
        ctx.has("workflow")
          ? ctx
              .get("workflow")
              .stages()
              .map((s) => s.id)
          : DEFAULT_STAGES,
    });
    const service: ValidateService = { ticket: v.ticket, file: v.file, all: v.all };
    ctx.provide("validate", service);

    const Input = z.object({ ticket: z.string().optional(), changed: z.string().optional() });
    const verb: VerbDef<typeof Input> = {
      id: "validate",
      summary: "Check ticket folders: ticket.toml, records, tasks, layout and the AC -> task -> test trace. Exits 1 on any error.",
      examples: ["hl validate", "hl validate T-014-sa --json", "hl validate --changed artifacts/T-014-sa/tasks.toml"],
      args: ["ticket"],
      input: Input,
      writes: false,
      async run(_v, i) {
        const findings = i.changed ? await v.file(i.changed) : i.ticket ? await v.ticket(i.ticket) : await v.all();
        const errors = findings.filter((f) => f.level === "error");
        const text = formatFindings(findings);
        if (!errors.length) return ok({ findings, errors: 0, warnings: findings.length }, text);
        const first = errors[0]!;
        return fail("validate", `${errors.length} error(s), ${findings.length - errors.length} warning(s)\n${text}`, { file: first.file, fix: first.fix });
      },
    };
    const verbs = ctx.get("verbs");
    await ctx.effect(() => verbs.register(verb as unknown as VerbDef));
  },
};

export default plugin;
