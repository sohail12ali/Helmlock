// FROZEN CONTRACT (milestone 1). Hook pipelines named domain/stage (F102).
import type { RunOptions } from "./services.ts";
import type { Actor, VerbResult } from "./verbs.ts";

export interface Hooks {
  "verb/pre-execute": { verb: string; input: Record<string, unknown>; actor: Actor; dryRun: boolean };
  "verb/post-execute": { verb: string; input: Record<string, unknown>; actor: Actor; result: VerbResult };
  "ticket/pre-move": { id: string; from: string; to: string; actor: Actor };
  "agent/pre-run": RunOptions;
  "approval/request": { action: string; detail: string; actor: Actor; decision?: "allow" | "deny"; reason?: string };
}
