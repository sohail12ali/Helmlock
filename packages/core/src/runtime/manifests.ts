// plugin.toml reading without zod: the CLI builds its command tree from these before any plugin code loads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import type { PluginCatalog } from "../contracts/catalog.ts";
import type { PluginManifest } from "../contracts/schemas.ts";

const strings = (v: unknown, field: string, file: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${file}: ${field} must be a list of strings`);
  return v as string[];
};

/** Read one plugin.toml; applies the PluginManifest defaults. */
export function readManifest(dir: string): PluginManifest {
  const file = join(dir, "plugin.toml");
  const raw = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`${file}: id is required`);
  if (raw.kind !== "code" && raw.kind !== "pack") throw new Error(`${file}: kind must be "code" or "pack"`);
  return {
    ...raw,
    id: raw.id,
    kind: raw.kind,
    version: String(raw.version ?? "0.0.0"),
    requires_core: typeof raw.requires_core === "string" ? raw.requires_core : ">=1 <2",
    provides: strings(raw.provides, "provides", file),
    requires: strings(raw.requires, "requires", file),
    verbs: strings(raw.verbs, "verbs", file),
    fills: strings(raw.fills, "fills", file),
    entry: typeof raw.entry === "string" ? raw.entry : "index.ts",
    required: raw.required === true,
  } as PluginManifest;
}

/** Every manifest in the catalog; a bad one is reported and skipped. */
export function readManifests(catalog: PluginCatalog, log: (line: string) => void = (l) => process.stderr.write(`hl: ${l}\n`)): Map<string, PluginManifest> {
  const out = new Map<string, PluginManifest>();
  for (const [id, entry] of Object.entries(catalog)) {
    try {
      out.set(id, readManifest(entry.dir));
    } catch (e) {
      log(`plugin ${id}: bad plugin.toml: ${(e as Error).message}`);
    }
  }
  return out;
}
