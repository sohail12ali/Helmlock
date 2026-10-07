// WALKING SKELETON (wave 0). S1 completes: hooks, guards, activity line, error mapping, did-you-mean.
import type { Context } from "../contracts/kernel.ts";
import type { VerbCtx, VerbDef, VerbResult, VerbsService } from "../contracts/verbs.ts";

export function createVerbRegistry(root: Context): VerbsService {
  const defs = new Map<string, VerbDef>();
  return {
    register(def) {
      if (defs.has(def.id)) throw new Error(`verb already registered: ${def.id}`);
      defs.set(def.id, def);
      return () => {
        defs.delete(def.id);
      };
    },
    get: (id) => defs.get(id),
    list: () => [...defs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    async run(id, rawInput, v): Promise<VerbResult> {
      const def = defs.get(id);
      if (!def) return { ok: false, code: 1, error: { rule: "unknown-verb", message: `unknown verb: ${id}`, fix: "run `hl help`" } };
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          code: 1,
          error: { rule: "bad-input", message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") },
        };
      }
      const vctx: VerbCtx = { ...v, ctx: v.ctx ?? root };
      try {
        return await def.run(vctx, parsed.data);
      } catch (e) {
        const err = e as Error & { rule?: string; file?: string; fix?: string };
        return { ok: false, code: 1, error: { rule: err.rule ?? "error", message: err.message, file: err.file, fix: err.fix } };
      }
    },
  };
}
