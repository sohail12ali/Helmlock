// FROZEN CONTRACT (milestone 1). How core finds plugins without importing the plugins package.
import type { PluginModule } from "./kernel.ts";

export interface CatalogEntry {
  /** Absolute folder holding plugin.toml and the entry module. */
  dir: string;
  load: () => Promise<{ default: PluginModule }>;
}
export type PluginCatalog = Record<string, CatalogEntry>;
