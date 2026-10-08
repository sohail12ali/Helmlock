// The providers plugin row of workspace.toml as the provider and model verbs read and write it: providers = [...],
// models = [...], default_model and the role models (assistant_model, ...). Every write goes through the file layer
// with the hash read here (stale-write checked) and honours dry run.
import type { FileLayer } from "@helmlock/core";
import { SettingError } from "./settings.ts";

export const WS_FILE = "workspace.toml";
/** Role keys that name a model; a removed model is cleared from them (they fall back to the default). */
export const ROLE_KEYS = ["assistant_model", "summariser_model", "titles_model", "refiner_model"] as const;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ProvidersDoc {
  data: Record<string, unknown>;
  hash: string | undefined;
  /** The providers row's config (a copy); empty when there is no row. */
  cfg: Record<string, unknown>;
  providers: Record<string, unknown>[];
  models: Record<string, unknown>[];
  default_model: string | undefined;
}

export async function readProvidersDoc(files: FileLayer, kind: string): Promise<ProvidersDoc> {
  if (!(await files.exists(WS_FILE))) throw new SettingError("config", "no workspace.toml here", "run hl inside a knowledge repo", WS_FILE);
  let doc: { data: Record<string, unknown>; hash?: string };
  try {
    doc = await files.readToml<Record<string, unknown>>(WS_FILE, kind);
  } catch (e) {
    throw new SettingError("config", `${WS_FILE} does not parse: ${(e as Error).message}`, "fix the TOML syntax", WS_FILE);
  }
  const rows = Array.isArray(doc.data.plugin) ? (doc.data.plugin as unknown[]) : [];
  let row: Record<string, unknown> | undefined;
  for (const r of rows) if (isObj(r) && r.id === "providers") row = r;
  const cfg = isObj(row?.config) ? { ...(row.config as Record<string, unknown>) } : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj).map((x) => ({ ...x })) : []);
  const def = typeof cfg.default_model === "string" && cfg.default_model ? cfg.default_model : undefined;
  return { data: doc.data, hash: doc.hash, cfg, providers: list(cfg.providers), models: list(cfg.models), default_model: def };
}

/** Write the providers row's config back: patches the last row with id "providers" (or adds one); every other row and
 *  key is kept. A key set to undefined in `cfg` is removed. */
export async function writeProvidersDoc(
  files: FileLayer,
  kind: string,
  d: ProvidersDoc,
  cfg: Record<string, unknown>,
  opts: { dryRun?: boolean },
): Promise<boolean> {
  const plugin = Array.isArray(d.data.plugin) ? [...(d.data.plugin as unknown[])] : [];
  let at = -1;
  plugin.forEach((r, n) => {
    if (isObj(r) && r.id === "providers") at = n;
  });
  const clean = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined));
  if (at >= 0) plugin[at] = { ...(plugin[at] as Record<string, unknown>), config: clean };
  else plugin.push({ id: "providers", config: clean });
  const res = await files.writeToml(WS_FILE, kind, { ...d.data, plugin }, { dryRun: opts.dryRun ?? false, ...(d.hash ? { expectHash: d.hash } : {}) });
  return res.changed;
}

/** "<provider>/<name as the server names it>"; server names may contain "/" themselves (LM Studio). */
export const modelIdFor = (provider: string, name: string): string => (name.startsWith(`${provider}/`) ? name : `${provider}/${name}`);

export interface ModelProbeInfo {
  id: string;
  context_window?: number | undefined;
  tool_calls?: boolean | undefined;
  vision?: boolean | undefined;
}

/** A model row: id, provider, label (the server name) and what a probe found. */
export function modelRow(provider: string, name: string, info?: ModelProbeInfo): Record<string, unknown> {
  const id = modelIdFor(provider, name);
  const m: Record<string, unknown> = { id, provider, label: id.slice(provider.length + 1) };
  if (info?.context_window !== undefined) m.context_window = info.context_window;
  if (info?.tool_calls !== undefined) m.tool_calls = info.tool_calls;
  if (info?.vision !== undefined) m.vision = info.vision;
  return m;
}

/** Probe info for a model name, matched by the server name or the full id. */
export function infoFor(provider: string, name: string, list: readonly ModelProbeInfo[] | undefined): ModelProbeInfo | undefined {
  const id = modelIdFor(provider, name);
  return list?.find((x) => modelIdFor(provider, x.id) === id);
}

export const knownIds = (models: Record<string, unknown>[]): string => models.map((m) => String(m.id)).join(", ") || "(none)";
