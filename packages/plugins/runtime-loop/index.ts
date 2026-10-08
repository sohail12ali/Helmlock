// Helmlock loop runtime (F153): registers the "loop" adapter with the runtimes service. Providers and the approval
// queue are looked up when a run needs them, so the plugin mounts with only the runtimes service present.
import type { PluginModule } from "@helmlock/core";
import { z } from "zod";
import { denyShellOf } from "../harness/hooks/logic.ts";
import { protectedGlobs } from "../runtimes/protect.ts";
import { createLoopAdapter } from "./adapter.ts";

const Config = z
  .object({
    max_steps: z.number().int().positive().optional(),
    timeout_sec: z.number().int().positive().optional(),
  })
  .loose();

const plugin: PluginModule<typeof Config> = {
  name: "runtime-loop",
  requires: ["runtimes"],
  Config,
  apply(ctx, config) {
    const ws = ctx.get("workspace");
    const roots = [ws.deliveryRoot, ws.root];
    const qc = ctx.has("config") ? ctx.get("config").pluginConfig("approval-queue") : {};
    const adapter = createLoopAdapter({
      providers: () => (ctx.has("providers") ? ctx.get("providers") : undefined),
      queue: () => (ctx.has("approvalQueue") ? ctx.get("approvalQueue") : undefined),
      root: ws.root,
      deliveryRoot: ws.deliveryRoot,
      ...(ws.author ? { author: ws.author } : {}),
      protectedGlobs: protectedGlobs(roots),
      denyShell: denyShellOf(roots),
      ...(typeof qc.approval_timeout_sec === "number" ? { approvalTimeoutMs: qc.approval_timeout_sec * 1000 } : {}),
      ...(config.max_steps ? { maxSteps: config.max_steps } : {}),
      ...(config.timeout_sec ? { defaultTimeoutSec: config.timeout_sec } : {}),
    });
    const off = ctx.get("runtimes").register(adapter);
    void ctx.effect(() => off);
  },
};

export default plugin;
