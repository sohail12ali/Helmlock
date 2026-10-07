// Config as composition (F103, F105): bundle rows -> workspace.toml [[plugin]] -> workspace.local.toml -> launch flags.
// A row with `use` adds or replaces a plugin; a row without `use` patches an existing id (unknown id = error).
// Each composed row records the last layer that touched it.
import type { FileLayer } from "../contracts/files.ts";
import type { PluginRow, WorkspaceToml } from "../contracts/schemas.ts";
import type { ConfigService, ConfigSource } from "../contracts/services.ts";

/** Data-only preset rows (F103). */
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

/** Top-level keys workspace.toml may hold (the WorkspaceToml schema). Anything else is refused (F105). */
export const WORKSPACE_KEYS = ["schema_version", "workspace", "bundles", "plugin", "layers", "retention"] as const;
const LOCAL_KEYS = ["schema_version", "plugin"] as const;

export type ComposedRow = PluginRow & { source: ConfigSource };

export class ConfigError extends Error {
  readonly rule = "config";
  readonly file?: string;
  readonly fix?: string;
  constructor(message: string, file?: string, fix?: string) {
    super(message);
    if (file) this.file = file;
    if (fix) this.fix = fix;
  }
}

/** Launch flags: `--plugin.<id>.<key>=value` arrive as {"plugin.<id>.<key>": value}; `--disable <id>` as {disable: id | id[]}. */
export type ConfigFlags = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!b) return a;
  if (!a) return { ...b };
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  return out;
}

function refuseUnknownKeys(raw: Record<string, unknown>, known: readonly string[], file: string): void {
  const bad = Object.keys(raw).filter((k) => !known.includes(k));
  if (bad.length)
    throw new ConfigError(
      `${file}: unknown top-level key${bad.length > 1 ? "s" : ""} ${bad.map((k) => `"${k}"`).join(", ")}. Known keys: ${known.join(", ")}`,
      file,
      `remove or rename ${bad.join(", ")}; plugin settings go under [[plugin]] rows as [plugin.config]`,
    );
}

/** Rows are checked by hand because a patch row has no `use` (PluginRow requires one). */
/** A [[plugin]] row as written: `use` is optional (a patch). */
interface RowPatch {
  id: string;
  use?: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
  [k: string]: unknown;
}

function readRows(raw: unknown, file: string): RowPatch[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ConfigError(`${file}: "plugin" must be an array of tables ([[plugin]])`, file);
  return raw.map((r, i) => {
    const where = `${file}: [[plugin]] row ${i + 1}`;
    if (!isObj(r)) throw new ConfigError(`${where} is not a table`, file);
    if (typeof r.id !== "string" || !r.id) throw new ConfigError(`${where} needs an id`, file, 'add id = "<plugin id>"');
    if (r.use !== undefined && (typeof r.use !== "string" || !r.use)) throw new ConfigError(`${where} (${r.id}): use must be a plugin name`, file);
    if (r.config !== undefined && !isObj(r.config)) throw new ConfigError(`${where} (${r.id}): config must be a table`, file);
    if (r.disabled !== undefined && typeof r.disabled !== "boolean") throw new ConfigError(`${where} (${r.id}): disabled must be true or false`, file);
    return r as RowPatch;
  });
}

/** Parse a flag value: true/false, numbers, otherwise the string. */
function flagValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export interface ComposeInput {
  workspace: Record<string, unknown> | undefined;
  local?: Record<string, unknown> | undefined;
  flags?: ConfigFlags;
  workspaceFile?: string;
  localFile?: string;
}

/** Pure composition, shared by loadConfig and tests. */
export function composeRows(i: ComposeInput): { workspace: WorkspaceToml; rows: ComposedRow[] } {
  const wsFile = i.workspaceFile ?? "workspace.toml";
  const localFile = i.localFile ?? "workspace.local.toml";
  const raw = i.workspace ?? { schema_version: 1, workspace: { name: "(none)" } };
  refuseUnknownKeys(raw, WORKSPACE_KEYS, wsFile);
  const bundles = raw.bundles ?? ["delivery-lite"];
  if (!Array.isArray(bundles) || bundles.some((b) => typeof b !== "string")) throw new ConfigError(`${wsFile}: bundles must be a list of names`, wsFile);
  const ws = {
    ...raw,
    bundles,
    workspace: isObj(raw.workspace) ? { plugin_dirs: [], ...raw.workspace } : raw.workspace,
    layers: raw.layers ?? [],
    plugin: [],
  } as unknown as WorkspaceToml;

  const rows = new Map<string, ComposedRow>();
  for (const b of bundles as string[]) {
    const preset = BUNDLES[b];
    if (!preset) throw new ConfigError(`${wsFile}: unknown bundle "${b}". Known: ${Object.keys(BUNDLES).join(", ")}`, wsFile);
    for (const r of preset) rows.set(r.id, { ...r, source: { layer: "bundle", file: b } });
  }

  const apply = (layer: ConfigSource["layer"], file: string, list: ReturnType<typeof readRows>) => {
    for (const r of list) {
      const prev = rows.get(r.id);
      if (!prev && !r.use)
        throw new ConfigError(
          `${file}: [[plugin]] id "${r.id}" patches a row that does not exist (not in a bundle and no use)`,
          file,
          `add use = "<plugin>" to define it, or fix the id. Known ids: ${[...rows.keys()].join(", ")}`,
        );
      const replaced = prev && r.use && r.use !== prev.use;
      const base: Partial<ComposedRow> = replaced || !prev ? {} : prev;
      const next: ComposedRow = { ...base, ...r, id: r.id, use: r.use ?? (prev?.use as string), source: { layer, file } };
      const cfg = deepMerge(base.config, r.config);
      if (cfg) next.config = cfg;
      else delete next.config;
      rows.set(r.id, next);
    }
  };

  apply("workspace.toml", wsFile, readRows(raw.plugin, wsFile));
  if (i.local) {
    refuseUnknownKeys(i.local, LOCAL_KEYS, localFile);
    apply("workspace.local.toml", localFile, readRows(i.local.plugin, localFile));
  }

  const flags = i.flags ?? {};
  const flagRows = new Map<string, RowPatch>();
  for (const [k, v] of Object.entries(flags)) {
    if (!k.startsWith("plugin.")) continue;
    const [, id, ...path] = k.split(".");
    if (!id || !path.length) throw new ConfigError(`flag --${k}: expected --plugin.<id>.<key>=<value>`);
    const row = flagRows.get(id) ?? { id, config: {} };
    let at = row.config as Record<string, unknown>;
    for (const p of path.slice(0, -1)) {
      if (!isObj(at[p])) at[p] = {};
      at = at[p] as Record<string, unknown>;
    }
    at[path[path.length - 1] as string] = flagValue(v);
    flagRows.set(id, row);
  }
  const disable = flags.disable === undefined ? [] : ([] as unknown[]).concat(flags.disable);
  for (const id of disable) {
    if (typeof id !== "string") continue;
    flagRows.set(id, { ...(flagRows.get(id) ?? { id }), disabled: true });
  }
  apply("flags", "launch flags", [...flagRows.values()]);

  return { workspace: ws, rows: [...rows.values()] };
}

export interface LoadedConfig extends ConfigService {
  /** True when workspace.toml exists. */
  readonly fromFile: boolean;
}

export async function loadConfig(files: FileLayer, flags: ConfigFlags = {}): Promise<LoadedConfig> {
  const read = async (rel: string) => {
    if (!(await files.exists(rel))) return undefined;
    try {
      return (await files.readTomlRaw(rel)).data;
    } catch (e) {
      throw new ConfigError(`${rel} does not parse: ${(e as Error).message}`, rel, "fix the TOML syntax");
    }
  };
  const wsRaw = await read("workspace.toml");
  const localRaw = await read("workspace.local.toml");
  const { workspace, rows } = composeRows({ workspace: wsRaw, local: localRaw, flags });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    workspace,
    fromFile: wsRaw !== undefined,
    rows: () => rows.map((r) => ({ ...r })),
    pluginConfig: (id) => byId.get(id)?.config ?? {},
  };
}

/** Validate workspace.toml against the shared schema (zod loaded lazily, off the startup path). */
export async function validateWorkspaceToml(raw: Record<string, unknown>): Promise<string[]> {
  const { WorkspaceToml } = await import("../contracts/schemas.ts");
  const res = WorkspaceToml.safeParse({ ...raw, plugin: [] });
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
