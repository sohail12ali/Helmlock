import type { RuntimeAdapter, RuntimesService } from "@helmlock/core";

/** Short names people type (`--runtime claude`) mapped to adapter ids. */
export const RUNTIME_ALIASES: Record<string, string> = { claude: "claude-code", "claude-code": "claude-code", cursor: "cursor" };

export function createRuntimesService(): RuntimesService {
  const adapters = new Map<string, RuntimeAdapter>();
  return {
    register(adapter) {
      if (adapters.has(adapter.id)) throw new Error(`runtime already registered: ${adapter.id}`);
      adapters.set(adapter.id, adapter);
      return () => {
        if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id);
      };
    },
    get: (id) => adapters.get(RUNTIME_ALIASES[id] ?? id),
    list: () => [...adapters.values()],
  };
}
