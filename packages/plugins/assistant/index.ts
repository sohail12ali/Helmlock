// Assistant plugin: provides `assistant` (F11d L3). Persona files: assistant/persona/{assistant,house-style}.md in the
// delivery repo, overridable by the same paths in the knowledge repo (F11f). Chats: chats/<id>.jsonl (local, B25).
import type { PluginModule } from "@helmlock/core";
import { createAssistant } from "./assistant.ts";
import { chatShareVerb } from "./share.ts";

export * from "./assistant.ts";
export * from "./share.ts";
export * from "./store.ts";
export * from "./tools.ts";
export * from "./window.ts";

const plugin: PluginModule = {
  name: "assistant",
  requires: ["files", "workspace", "verbs", "providers"],
  async apply(ctx) {
    ctx.provide("assistant", createAssistant(ctx));
    const share = chatShareVerb();
    await ctx.effect(() => ctx.get("verbs").register(share));
  },
};

export default plugin;
