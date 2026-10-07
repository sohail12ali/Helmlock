// WALKING SKELETON (wave 0). S1 owns: where, doctor, help agent, config show.
import { z } from "zod";
import type { Context } from "../contracts/kernel.ts";
import { ok } from "../contracts/verbs.ts";

export function registerCoreVerbs(ctx: Context): void {
  const verbs = ctx.get("verbs");
  verbs.register({
    id: "where",
    summary: "Show the resolved knowledge repo, delivery repo, folders and author, and where each came from.",
    examples: ["hl where", "hl where --json"],
    input: z.object({}),
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
}
