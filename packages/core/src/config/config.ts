// WALKING SKELETON (wave 0). S1 replaces this with full composition (bundles, layers, patch by id, merge rules).
import type { FileLayer } from "../contracts/files.ts";
import { PluginRow, WorkspaceToml } from "../contracts/schemas.ts";
import type { ConfigService, ConfigSource } from "../contracts/services.ts";

/** The default bundle: data-only preset rows (F103). */
export const BUNDLES: Record<string, PluginRow[]> = {
  "delivery-lite": [
    "roster",
    "activity",
    "tickets-toml",
    "workflow-lite",
    "validate",
    "todos",
    "work-log",
    "search",
    "context",
    "skills",
    "harness",
    "runtimes",
    "runtime-claude",
    "runtime-cursor",
    "scaffold",
  ].map((id) => ({ id, use: id })),
};

export async function loadConfig(files: FileLayer, flags: Record<string, unknown> = {}): Promise<ConfigService> {
  let ws: WorkspaceToml;
  let fromFile = false;
  if (await files.exists("workspace.toml")) {
    ws = WorkspaceToml.parse((await files.readTomlRaw("workspace.toml")).data);
    fromFile = true;
  } else {
    ws = WorkspaceToml.parse({ schema_version: 1, workspace: { name: "(none)" } });
  }
  const rows = new Map<string, PluginRow & { source: ConfigSource }>();
  for (const b of ws.bundles) for (const r of BUNDLES[b] ?? []) rows.set(r.id, { ...r, source: { layer: "bundle" } });
  for (const r of ws.plugin) rows.set(r.id, { ...rows.get(r.id), ...PluginRow.parse(r), source: { layer: "workspace.toml", file: "workspace.toml" } });
  void fromFile;
  void flags;
  return {
    workspace: ws,
    rows: () => [...rows.values()],
    pluginConfig: (id) => rows.get(id)?.config ?? {},
  };
}
