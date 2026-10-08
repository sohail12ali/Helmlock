// Settings plugin: `hl config set <plugin> <key> <value> [--local]`, validated against the plugin's
// [settings.<key>] tables (F44). Writes go through the file layer (atomic, stale-write checked) with a closed
// emitter that keeps every other key and [[plugin]] row. Config is re-read by the next call (F107: no re-mount).
import type { FileLayer, PluginManifest, PluginModule, TomlEmitter, VerbDef } from "@helmlock/core";
import { composeRows, ok, readManifests } from "@helmlock/core";
import { z } from "zod";
import { catalog } from "../registry.ts";
import { providerAddVerb } from "./provider-add.ts";
import { secretSetVerb, secretStatusVerb } from "./secret.ts";
import { coerceValue, type SettingDecl, SettingError, type SettingValue, setInDoc, settingsOf } from "./settings.ts";

export * from "./secret.ts";
export * from "./settings.ts";

export const WORKSPACE_CONFIG_KIND = "workspace-config";
export const WORKSPACE_FILE = "workspace.toml";
export const LOCAL_FILE = "workspace.local.toml";

/** workspace.toml and workspace.local.toml share one shape: root keys, [workspace], [[plugin]] with [plugin.config]. */
export const workspaceConfigEmitter: TomlEmitter<Record<string, unknown>> = {
  kind: WORKSPACE_CONFIG_KIND,
  schema: z.object({}).loose(),
  version: 1,
  order: {
    "": ["schema_version", "bundles", "workspace", "plugin", "layers", "retention"],
    workspace: ["name", "console_name", "plugin_dirs"],
    plugin: ["id", "use", "disabled", "config"],
  },
};

let manifestCache: Map<string, PluginManifest> | undefined;
const manifests = () => {
  manifestCache ??= readManifests(catalog, () => {});
  return manifestCache;
};

export interface SetResult {
  plugin: string;
  key: string;
  value: SettingValue;
  file: string;
  changed: boolean;
}

async function readDoc(files: FileLayer, rel: string): Promise<{ data: Record<string, unknown>; hash?: string } | undefined> {
  if (!(await files.exists(rel))) return undefined;
  try {
    return await files.readToml<Record<string, unknown>>(rel, WORKSPACE_CONFIG_KIND);
  } catch (e) {
    throw new SettingError("config", `${rel} does not parse: ${(e as Error).message}`, "fix the TOML syntax", rel);
  }
}

/** Validate and write one setting. Throws SettingError (rule config-unknown-key / config-bad-value / config). */
export async function setSetting(
  files: FileLayer,
  i: { plugin: string; key: string; value: unknown; local?: boolean },
  opts: { dryRun?: boolean; manifests?: Map<string, PluginManifest> } = {},
): Promise<SetResult> {
  const ws = await readDoc(files, WORKSPACE_FILE);
  if (!ws) throw new SettingError("config", `no ${WORKSPACE_FILE} here`, "run hl inside a knowledge repo", WORKSPACE_FILE);
  const local = await readDoc(files, LOCAL_FILE);
  const { rows } = composeRows({ workspace: ws.data, local: local?.data });
  const row = rows.find((r) => r.id === i.plugin);
  const all = opts.manifests ?? manifests();
  const decls: SettingDecl[] = row && all.get(row.use) ? settingsOf(all.get(row.use) as PluginManifest) : [];
  if (!row)
    throw new SettingError(
      "config-unknown-key",
      `no plugin row "${i.plugin}" in this workspace`,
      `known plugins with settings: ${rows
        .filter((r) => all.get(r.use) && settingsOf(all.get(r.use) as PluginManifest).length)
        .map((r) => r.id)
        .join(", ")}`,
    );
  const decl = decls.find((d) => d.key === i.key);
  if (!decl)
    throw new SettingError(
      "config-unknown-key",
      `plugin ${i.plugin} declares no setting "${i.key}"`,
      decls.length ? `known keys: ${decls.map((d) => d.key).join(", ")}` : `plugin ${i.plugin} has no settings`,
    );
  const value = coerceValue(i.plugin, decl, i.value);
  const rel = decl.scope === "local" || i.local ? LOCAL_FILE : WORKSPACE_FILE;
  const current = rel === LOCAL_FILE ? local : ws;
  const next = setInDoc(current?.data ?? { schema_version: 1 }, i.plugin, i.key, value);
  // The result must still compose (e.g. a patch row in workspace.local.toml needs its id defined below it).
  try {
    composeRows(rel === LOCAL_FILE ? { workspace: ws.data, local: next } : { workspace: next, local: local?.data });
  } catch (e) {
    const err = e as Error & { fix?: string };
    throw new SettingError("config", err.message, err.fix, rel);
  }
  const res = await files.writeToml(rel, WORKSPACE_CONFIG_KIND, next, {
    dryRun: opts.dryRun ?? false,
    ...(current?.hash ? { expectHash: current.hash } : {}),
  });
  return { plugin: i.plugin, key: i.key, value, file: rel, changed: res.changed };
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();

/** Keeps the input type for run() and erases it for the registry. */
const verb = <I extends z.ZodType>(d: VerbDef<I, SetResult>): VerbDef => d as unknown as VerbDef;

const configSet = verb({
  id: "config set",
  summary: "Set one plugin setting declared in its plugin.toml: shared in workspace.toml, per-machine with --local.",
  examples: [
    "hl config set work-log day_hours 7",
    "hl config set runtime-claude command C:/tools/claude.exe",
    "hl config set runtimes silence_sec 900 --dry-run",
    'hl config set telegram allowed_user_ids "12345, 67890"',
  ],
  args: ["plugin", "key", "value"],
  input: z.object({
    plugin: z.string().min(1),
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
    local: flag,
  }),
  writes: true,
  async run(v, i) {
    const r = await setSetting(v.ctx.get("files"), i, { dryRun: v.dryRun });
    const shown = typeof r.value === "string" || Array.isArray(r.value) ? JSON.stringify(r.value) : String(r.value);
    const verb = v.dryRun ? "would set" : r.changed ? "set" : "unchanged:";
    // Config reload only (F107): hl commands read it now; a running `hl serve` picks it up when restarted (F132 style).
    const note = r.changed && !v.dryRun ? " (applies to hl commands now; restart hl serve for the console)" : "";
    return ok({ ...r, applies: "next-start" }, `${verb} ${r.plugin}.${r.key} = ${shown} in ${r.file}${note}`);
  },
});

const plugin: PluginModule = {
  name: "settings",
  requires: ["files", "verbs"],
  async apply(ctx) {
    const files = ctx.get("files");
    await ctx.effect(() => files.registerEmitter(workspaceConfigEmitter));
    await ctx.effect(() => ctx.get("verbs").register(configSet));
    await ctx.effect(() => ctx.get("verbs").register(providerAddVerb(WORKSPACE_CONFIG_KIND)));
    await ctx.effect(() => ctx.get("verbs").register(secretSetVerb));
    await ctx.effect(() => ctx.get("verbs").register(secretStatusVerb));
  },
};

export default plugin;
