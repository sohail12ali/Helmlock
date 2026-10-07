// notes: `hl notes build` writes Obsidian notes from the TOML (F52); `hl index build` writes shared/INDEX.md (F116).
import type { PluginModule, VerbDef } from "@helmlock/core";
import { ok } from "@helmlock/core";
import { z } from "zod";
import { buildNotes } from "./notes.ts";
import { buildIndex } from "./shared-index.ts";

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

const notesBuild = verb({
  id: "notes build",
  summary: "Write Obsidian notes (notes/tickets, notes/records, notes/projects) from the TOML. Local and gitignored; safe to rerun.",
  examples: ["hl notes build", "hl notes build --ticket T-014-sa", "hl notes build --dry-run --json"],
  input: z.object({ ticket: z.string().optional() }),
  writes: true,
  async run(v, i) {
    const r = await buildNotes(v.ctx, { ...(i.ticket ? { ticket: i.ticket } : {}), dryRun: v.dryRun });
    const verbWord = v.dryRun ? "would write" : "wrote";
    return ok(r, `${verbWord} ${r.written.length} note(s), ${r.unchanged} unchanged, ${r.removed.length} stale removed${v.dryRun ? " (dry run)" : ""}`);
  },
});

const indexBuild = verb({
  id: "index build",
  summary: "Rewrite shared/INDEX.md: one line per document in shared/ and projects/*/wiki/ (path, kind, title, summary).",
  examples: ["hl index build", "hl index build --dry-run --json"],
  input: z.object({}),
  writes: true,
  async run(v) {
    const r = await buildIndex(v.ctx, { dryRun: v.dryRun });
    const state = r.changed ? (v.dryRun ? "would update" : "updated") : "unchanged";
    return ok(r, `${r.path} ${state}: ${r.entries.length} document(s)`);
  },
});

const plugin: PluginModule = {
  name: "notes",
  requires: ["files", "verbs", "tickets", "records", "tasks"],
  async apply(ctx) {
    for (const def of [notesBuild, indexBuild]) await ctx.effect(() => ctx.get("verbs").register(def));
  },
};

export default plugin;
