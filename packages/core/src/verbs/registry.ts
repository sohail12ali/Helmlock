// One verb registry for CLI, hooks, assistant and Telegram (F13a).
// Shape follows control-center console/server/verbs.py: definitions are resolved when registered,
// gates (here: guards) are checked separately from the run.
//
// run(): validate input -> guards on "verb/pre-execute" (any deny = code 2) -> pre hook -> def.run
//        -> post hook -> activity line for writes (not in dry run) -> "verb.done".
import type { z } from "zod";
import type { Context } from "../contracts/kernel.ts";
import type { ActivityService } from "../contracts/services.ts";
import type { Actor, VerbCtx, VerbDef, VerbError, VerbResult, VerbsService } from "../contracts/verbs.ts";
import { didYouMean } from "./suggest.ts";

export interface VerbRegistry extends VerbsService {
  /** Ids close to `id`, for "did you mean". */
  suggest(id: string): string[];
}

/**
 * Keeps the input type for `run` while registering: `verbs.register(defineVerb({ input: z.object(...), run: (v, i) => ... }))`.
 * (VerbsService.register takes the erased VerbDef, so `i` would otherwise be unknown.)
 */
export function defineVerb<I extends z.ZodType, O = unknown>(def: VerbDef<I, O>): VerbDef {
  return def as unknown as VerbDef;
}

type ThrownVerbError = Error & Partial<VerbError> & { code?: unknown; data?: unknown };

/** Map anything thrown by a verb to a result: code 2 only when the error says so, otherwise 1. */
export function errorResult(e: unknown): VerbResult<never> {
  const err = (e instanceof Error ? e : new Error(String(e))) as ThrownVerbError;
  const error: VerbError = { rule: typeof err.rule === "string" ? err.rule : "error", message: err.message };
  if (typeof err.file === "string") error.file = err.file;
  if (typeof err.fix === "string") error.fix = err.fix;
  const res: VerbResult<never> = { ok: false, code: err.code === 2 ? 2 : 1, error };
  if (err.data !== undefined) res.data = err.data; // a thrown failure may carry data too (e.g. gate reasons)
  return res;
}

function entityOf(res: VerbResult, input: Record<string, unknown>, secret: readonly string[] = []): string | undefined {
  const d = res.ok ? res.data : undefined;
  if (d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string" && !secret.includes("id")) return (d as { id: string }).id;
  for (const k of ["id", "ticket"]) if (typeof input[k] === "string" && !secret.includes(k)) return input[k] as string;
  return undefined;
}

export function createVerbRegistry(root: Context): VerbRegistry {
  const defs = new Map<string, VerbDef>();

  const finish = async (def: VerbDef, input: Record<string, unknown>, v: VerbCtx, res: VerbResult): Promise<VerbResult> => {
    const code = res.ok ? 0 : res.code;
    const entity = entityOf(res, input, def.secret);
    // No activity line outside a knowledge repo (e.g. `hl init` run before one exists).
    const w = v.ctx.has("workspace") ? v.ctx.get("workspace") : undefined;
    const outside = w !== undefined && (w.codeWorkspaceFile === undefined || w.root === w.deliveryRoot);
    if (def.writes && !v.dryRun && !outside && v.ctx.has("activity")) {
      try {
        const line: Parameters<ActivityService["append"]>[0] = {
          actor: { kind: v.actor.kind, id: v.actor.id },
          on_behalf_of: v.actor.onBehalfOf,
          verb: def.id,
          code,
        };
        if (entity) line.entity = entity;
        await v.ctx.get("activity").append(line);
      } catch (e) {
        process.stderr.write(`hl: activity line for ${def.id} not written: ${(e as Error).message}\n`);
      }
    }
    const done: { verb: string; code: 0 | 1 | 2; actor: Actor; dryRun: boolean; entity?: string } = { verb: def.id, code, actor: v.actor, dryRun: v.dryRun };
    if (entity) done.entity = entity;
    await v.ctx.emit("verb.done", done);
    return res;
  };

  return {
    register(def) {
      if (defs.has(def.id)) throw Object.assign(new Error(`verb already registered: ${def.id}`), { rule: "duplicate-verb" });
      if (!def.examples.length) throw new Error(`verb ${def.id} needs at least one example`);
      defs.set(def.id, def);
      return () => {
        if (defs.get(def.id) === def) defs.delete(def.id);
      };
    },
    get: (id) => defs.get(id),
    list: () => [...defs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    suggest: (id) => didYouMean(id, defs.keys()),

    async run(id, rawInput, opts): Promise<VerbResult> {
      const def = defs.get(id);
      if (!def) {
        const near = didYouMean(id, defs.keys());
        return {
          ok: false,
          code: 1,
          error: { rule: "unknown-verb", message: `unknown verb: ${id}${near.length ? `. Did you mean: ${near.join(", ")}?` : ""}`, fix: "run `hl --help`" },
        };
      }
      const v: VerbCtx = { ...opts, ctx: opts.ctx ?? root };
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        const message = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`).join("; ");
        return finish(def, rawInput, v, { ok: false, code: 1, error: { rule: "bad-input", message, fix: `see \`hl ${id} --help\`` } });
      }
      let input = parsed.data as Record<string, unknown>;
      let res: VerbResult;
      try {
        const denies = await v.ctx.checkGuards("verb/pre-execute", { verb: id, input, actor: v.actor, dryRun: v.dryRun });
        if (denies.length) return finish(def, input, v, { ok: false, code: 2, error: { rule: "guard", message: denies.join("; ") } });
        const pre = await v.ctx.runHook("verb/pre-execute", { verb: id, input, actor: v.actor, dryRun: v.dryRun });
        input = pre.input;
        res = await def.run({ ...v, dryRun: pre.dryRun || v.dryRun }, input);
        const post = await v.ctx.runHook("verb/post-execute", { verb: id, input, actor: v.actor, result: res });
        res = post.result;
      } catch (e) {
        res = errorResult(e);
      }
      return finish(def, input, v, res);
    },
  };
}
