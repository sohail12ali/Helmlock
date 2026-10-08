// GET /api/v1/overrides (milestone 6, Blueprint 31): every agent and skill with the layer that wins
// (local > personal > workspace > system) and the copies it hides. Read-only; the same rows as `hl overrides --json`.
import type { OverridesView, Runtime } from "@helmlock/core";
import { overridesView } from "@helmlock/plugins/harness/layers.ts";

export async function overridesRoute(runtime: Runtime): Promise<OverridesView> {
  const ws = runtime.ctx.get("workspace");
  return overridesView(ws.root, ws.deliveryRoot, ws.author);
}
