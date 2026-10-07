// Claude Code runtime: registers the "claude-code" adapter with the runtimes service.
import type { PluginModule } from "@helmlock/core";
import { z } from "zod";
import { protectedGlobs } from "../runtimes/protect.ts";
import { createClaudeAdapter } from "./adapter.ts";

const Config = z
  .object({
    command: z.string().optional(),
    /** Post-run check of protected state paths (shell commands bypass the Edit/Write deny rules). */
    protect: z.boolean().default(true),
    linger_ms: z.number().int().nonnegative().optional(),
  })
  .loose();

const plugin: PluginModule<typeof Config> = {
  name: "runtime-claude",
  requires: ["runtimes"],
  Config,
  apply(ctx, config) {
    const ws = ctx.get("workspace");
    const adapter = createClaudeAdapter({
      ...(config.command ? { command: config.command } : {}),
      ...(config.linger_ms !== undefined ? { lingerMs: config.linger_ms } : {}),
      ...(config.protect ? { protect: { root: ws.root, globs: protectedGlobs([ws.root, ws.deliveryRoot]) } } : {}),
    });
    const off = ctx.get("runtimes").register(adapter);
    void ctx.effect(() => off);
  },
};

export default plugin;
