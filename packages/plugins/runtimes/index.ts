// Runtimes plugin: the adapter registry (service "runtimes"), the run manager (service "runManager"), `hl run`,
// `hl run attach` and `hl run report`.
import type { PluginModule, VerbDef } from "@helmlock/core";
import { z } from "zod";
import { createAttachVerb } from "./attach.ts";
import { createRuntimesService } from "./registry.ts";
import { createRunManager } from "./run-manager.ts";
import { createRunReportVerb } from "./run-report.ts";
import { createRunVerb } from "./run-verb.ts";

const Config = z
  .object({
    default_runtime: z.string().optional(),
    silence_sec: z.number().int().positive().optional(),
    max_live: z.number().int().positive().optional(),
  })
  .loose();

const plugin: PluginModule<typeof Config> = {
  name: "runtimes",
  requires: ["verbs"],
  Config,
  apply(ctx, config) {
    ctx.provide("runtimes", createRuntimesService());
    // Runs started from the server; adapters are looked up at start time, so later runtime plugins are seen.
    const manager = createRunManager({
      ctx,
      ...(config.default_runtime ? { defaultRuntime: config.default_runtime } : {}),
      ...(config.silence_sec ? { defaultSilenceSec: config.silence_sec } : {}),
      ...(config.max_live ? { maxLive: config.max_live } : {}),
    });
    ctx.provide("runManager", manager);
    void ctx.effect(() => () => manager.dispose());
    const verbs = ctx.get("verbs");
    const offs = [
      verbs.register(createRunVerb({ defaultRuntime: config.default_runtime, defaultSilenceSec: config.silence_sec }) as unknown as VerbDef),
      verbs.register(createAttachVerb()),
      verbs.register(createRunReportVerb()),
    ];
    for (const off of offs) void ctx.effect(() => off);
  },
};

export default plugin;
