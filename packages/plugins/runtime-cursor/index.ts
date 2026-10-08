// Cursor CLI runtime: registers the "cursor" adapter with the runtimes service.
import type { PluginModule } from "@helmlock/core";
import { z } from "zod";
import { protectedGlobs } from "../runtimes/protect.ts";
import { createCursorAdapter } from "./adapter.ts";

const Config = z
  .object({
    command: z.string().optional(),
    /** Cursor print mode ignores .cursor/cli.json deny rules, so this check stays on unless turned off here. */
    protect: z.boolean().default(true),
    linger_ms: z.number().int().nonnegative().optional(),
  })
  .loose();

const plugin: PluginModule<typeof Config> = {
  name: "runtime-cursor",
  requires: ["runtimes"],
  Config,
  apply(ctx, config) {
    const ws = ctx.get("workspace");
    const adapter = createCursorAdapter({
      ...(config.command ? { command: config.command } : {}),
      ...(config.linger_ms !== undefined ? { lingerMs: config.linger_ms } : {}),
      protect: config.protect ? { root: ws.root, globs: protectedGlobs([ws.root, ws.deliveryRoot]) } : false,
    });
    const off = ctx.get("runtimes").register(adapter);
    void ctx.effect(() => off);
  },
};

export default plugin;
