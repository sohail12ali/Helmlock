// Providers plugin: provides `providers` (one OpenAI-compatible layer, F11a). The tables live in the plugin row's
// config and are re-read on every call; presets/*.toml fill a row's defaults (F72).
import type { PluginModule } from "@helmlock/core";
import { createProviders } from "./providers.ts";

export * from "./config.ts";
export * from "./providers.ts";
export * from "./wire.ts";

const plugin: PluginModule = {
  name: "providers",
  requires: ["files", "workspace", "config"],
  async apply(ctx, config) {
    const rowId = ctx.name;
    const row = ctx
      .get("config")
      .rows()
      .find((r) => r.id === rowId || r.use === "providers");
    ctx.provide(
      "providers",
      createProviders({
        root: ctx.get("workspace").root,
        files: ctx.get("files"),
        mountConfig: (config ?? {}) as Record<string, unknown>,
        pinned: row?.source.layer === "flags",
        rowId: row?.id ?? "providers",
        log: (l) => process.stderr.write(`hl: ${l}\n`),
      }),
    );
  },
};

export default plugin;
