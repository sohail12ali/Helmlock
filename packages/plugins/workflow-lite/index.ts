// workflow-lite (stream S3): a declarative pack. Stages and transitions come from workflow.toml; gates from gates.ts.
// records, tasks and files are looked up at check() time, so this plugin can mount before tickets-toml.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, GateResult, PluginModule, StageDef, Ticket, WorkflowService } from "@helmlock/core";
import { parse } from "smol-toml";
import { GATES } from "./gates.ts";

export interface TransitionDef {
  from: string;
  to: string;
  direction?: "forward" | "back";
  gate: string[];
}
export interface WorkflowPack {
  id: string;
  stages: (StageDef & { blurb?: string; tone?: string })[];
  transitions: TransitionDef[];
}

export function loadPack(file = join(import.meta.dirname, "workflow.toml")): WorkflowPack {
  const raw = parse(readFileSync(file, "utf8")) as { id?: string; stage?: Record<string, unknown>[]; transition?: Record<string, unknown>[] };
  const stages = (raw.stage ?? []).map((s) => {
    if (typeof s.id !== "string" || typeof s.label !== "string") throw new Error(`${file}: every [[stage]] needs id and label`);
    return s as unknown as WorkflowPack["stages"][number];
  });
  const ids = new Set(stages.map((s) => s.id));
  const transitions = (raw.transition ?? []).map((t) => {
    const tr = { from: String(t.from), to: String(t.to), direction: t.direction as TransitionDef["direction"], gate: (t.gate as string[] | undefined) ?? [] };
    for (const end of [tr.from, tr.to]) if (end !== "*" && !ids.has(end)) throw new Error(`${file}: transition names unknown stage ${end}`);
    for (const g of tr.gate) if (!GATES[g]) throw new Error(`${file}: unknown gate ${g}`);
    return tr;
  });
  return { id: raw.id ?? "workflow", stages, transitions };
}

export function createWorkflow(ctx: Context, pack: WorkflowPack): WorkflowService {
  const index = (id: string) => pack.stages.findIndex((s) => s.id === id);
  return {
    stages: () => pack.stages.map((s) => ({ ...s })),
    async check(ticket: Ticket, to: string): Promise<GateResult> {
      const from = ticket.ticket.stage;
      const ti = index(to);
      if (ti < 0) {
        return {
          allowed: false,
          reasons: [{ rule: "unknown-stage", message: `unknown stage ${to}`, fix: `use one of: ${pack.stages.map((s) => s.id).join(", ")}` }],
        };
      }
      if (from === to) return { allowed: true, reasons: [] };
      const fi = index(from);
      const direction = fi >= 0 && ti < fi ? "back" : "forward";
      const tr = pack.transitions.find(
        (t) => (t.from === "*" || t.from === from) && (t.to === "*" || t.to === to) && (t.direction === undefined || t.direction === direction),
      );
      if (!tr) {
        const nextStage = fi >= 0 ? pack.stages[fi + 1]?.id : undefined;
        return {
          allowed: false,
          reasons: [
            {
              rule: "transition",
              message: `${from} -> ${to} is not allowed; move forward one stage at a time`,
              fix: nextStage ? `hl ticket move ${ticket.ticket.id} ${nextStage}` : undefined,
            },
          ],
        };
      }
      const reasons: GateResult["reasons"] = [];
      for (const name of tr.gate) {
        const r = await GATES[name]!(ticket, ctx);
        if (r) reasons.push({ rule: `gate:${name}`, message: r.message, fix: r.fix });
      }
      return { allowed: reasons.length === 0, reasons };
    },
  };
}

const plugin: PluginModule = {
  name: "workflow-lite",
  requires: ["files"],
  apply(ctx) {
    ctx.provide("workflow", createWorkflow(ctx, loadPack()));
  },
};

export default plugin;
