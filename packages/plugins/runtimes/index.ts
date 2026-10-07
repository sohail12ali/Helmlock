// Runtimes plugin: the adapter registry (service "runtimes") and the `hl run` verb.
import type { PluginModule, VerbDef } from "@helmlock/core";
import { z } from "zod";
import { createRuntimesService } from "./registry.ts";
import { createRunVerb } from "./run-verb.ts";

const Config = z
  .object({
    default_runtime: z.string().optional(),
    silence_sec: z.number().int().positive().optional(),
  })
  .loose();

const plugin: PluginModule<typeof Config> = {
  name: "runtimes",
  requires: ["verbs"],
  Config,
  apply(ctx, config) {
    ctx.provide("runtimes", createRuntimesService());
    const off = ctx
      .get("verbs")
      .register(createRunVerb({ defaultRuntime: config.default_runtime, defaultSilenceSec: config.silence_sec }) as unknown as VerbDef);
    void ctx.effect(() => off);
  },
};

export default plugin;
