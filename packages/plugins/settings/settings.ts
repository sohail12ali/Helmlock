// Plugin settings (F44, F9a, F9b): plugins declare [settings.<key>] tables in plugin.toml; the console's Settings
// screen and `hl config set` are generated from them. Values live in [[plugin]] rows: shared ones in workspace.toml,
// per-machine ones in workspace.local.toml (F103). Secrets are stored as env-var NAMES only, never the secret.
// Form shape follows Paperclip's getConfigSchema / ConfigFieldSchema (type, label, hint, default, options).
import type { PluginManifest, PluginSettings, SettingField, SettingsView } from "@helmlock/core";
import { composeRows } from "@helmlock/core";

export type SectionId = SettingsView["sections"][number]["id"];
export type ValueSource = PluginSettings["values"][string]["source"];

/** F9a sections in screen order. A section may be empty (the screen says what is coming). */
export const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "models", label: "Models" },
  { id: "agents", label: "Agents" },
  { id: "permissions", label: "Permissions" },
  { id: "telegram", label: "Telegram" },
];

const TYPES = ["string", "number", "boolean", "select", "secret-env"] as const;
/** An environment variable name: what a secret-env setting stores (F9b). */
export const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A declared setting with the manifest-only extras the contract does not carry. */
export interface SettingDecl extends SettingField {
  section: SectionId;
  min?: number;
  max?: number;
  integer?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** "work-log" -> "Work log". */
export const pluginLabel = (id: string): string => {
  const s = id.replace(/[-_]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The [settings.*] tables of one manifest. A malformed table is reported through `problems` and skipped. */
export function settingsOf(m: PluginManifest, problems: string[] = []): SettingDecl[] {
  const raw = m.settings;
  if (!isObj(raw)) return [];
  const out: SettingDecl[] = [];
  for (const [key, t] of Object.entries(raw)) {
    const where = `plugin ${m.id}: [settings.${key}]`;
    if (!isObj(t)) {
      problems.push(`${where} is not a table`);
      continue;
    }
    const type = t.type === "bool" ? "boolean" : t.type;
    if (!(TYPES as readonly unknown[]).includes(type)) {
      problems.push(`${where}: type must be one of ${TYPES.join(", ")}`);
      continue;
    }
    const section = t.section ?? "workspace";
    if (!SECTIONS.some((s) => s.id === section)) {
      problems.push(`${where}: section must be one of ${SECTIONS.map((s) => s.id).join(", ")}`);
      continue;
    }
    const scope = t.scope ?? "workspace";
    if (scope !== "workspace" && scope !== "local") {
      problems.push(`${where}: scope must be workspace or local`);
      continue;
    }
    const d: SettingDecl = {
      key,
      type: type as SettingField["type"],
      label: typeof t.label === "string" ? t.label : key,
      scope,
      section: section as SectionId,
    };
    if (typeof t.hint === "string") d.hint = t.hint;
    if (typeof t.default === "string" || typeof t.default === "number" || typeof t.default === "boolean") d.default = t.default;
    if (Array.isArray(t.options)) d.options = t.options.map(String);
    if (typeof t.min === "number") d.min = t.min;
    if (typeof t.max === "number") d.max = t.max;
    if (t.integer === true) d.integer = true;
    if (d.type === "select" && !d.options?.length) {
      problems.push(`${where}: a select needs options`);
      continue;
    }
    out.push(d);
  }
  return out;
}

/** The contract's SettingField (no manifest-only extras). */
export function toField(d: SettingDecl): SettingField {
  const { section: _s, min: _min, max: _max, integer: _i, ...f } = d;
  return f;
}

export class SettingError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  readonly file: string | undefined;
  constructor(rule: string, message: string, fix?: string, file?: string) {
    super(message);
    this.rule = rule;
    this.fix = fix;
    this.file = file;
  }
}

/** Check and convert a value (from the CLI as text, or from the console as JSON) to the declared type. */
export function coerceValue(plugin: string, d: SettingDecl, value: unknown): string | number | boolean {
  const bad = (why: string) =>
    new SettingError(
      "config-bad-value",
      `${plugin}.${d.key}: ${why}, got ${JSON.stringify(value)}`,
      `see the [settings.${d.key}] table of the ${plugin} plugin`,
    );
  switch (d.type) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw bad("expected true or false");
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
      if (!Number.isFinite(n)) throw bad("expected a number");
      if (d.integer && !Number.isInteger(n)) throw bad("expected a whole number");
      if (d.min !== undefined && n < d.min) throw bad(`must be at least ${d.min}`);
      if (d.max !== undefined && n > d.max) throw bad(`must be at most ${d.max}`);
      return n;
    }
    case "select":
      if (typeof value !== "string" || !d.options?.includes(value)) throw bad(`expected one of ${d.options?.join(", ")}`);
      return value;
    case "secret-env":
      if (typeof value !== "string" || !ENV_NAME.test(value))
        throw new SettingError(
          "config-bad-value",
          `${plugin}.${d.key} stores the NAME of an environment variable (e.g. OPENROUTER_API_KEY), never the secret itself`,
          "set the secret in your environment and store its variable name here",
        );
      return value;
    default:
      if (typeof value !== "string") throw bad("expected text");
      return value;
  }
}

interface RawRow {
  id?: unknown;
  config?: unknown;
}
const rowsOf = (doc: Record<string, unknown> | undefined): RawRow[] => (Array.isArray(doc?.plugin) ? (doc.plugin as RawRow[]).filter(isObj) : []);

/** True when some [[plugin]] row with this id sets `key` in the given file. */
function setsKey(doc: Record<string, unknown> | undefined, id: string, key: string): boolean {
  return rowsOf(doc).some((r) => r.id === id && isObj(r.config) && key in r.config);
}

export interface SettingsInput {
  manifests: Map<string, PluginManifest>;
  workspace: Record<string, unknown> | undefined;
  local?: Record<string, unknown> | undefined;
}

/** The F9a Settings screen: each section, the plugins with fields in it, and composed values with their layer. */
export function buildSettingsView(i: SettingsInput): SettingsView {
  const { rows } = composeRows({ workspace: i.workspace, local: i.local });
  const sections: SettingsView["sections"] = SECTIONS.map((s) => ({ id: s.id, label: s.label, plugins: [] }));
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const m = i.manifests.get(row.use);
    if (!m) continue;
    const decls = settingsOf(m);
    for (const sec of sections) {
      const mine = decls.filter((d) => d.section === sec.id);
      if (!mine.length) continue;
      const values: PluginSettings["values"] = {};
      for (const d of mine) {
        const cfg = row.config ?? {};
        let source: ValueSource = "default";
        if (setsKey(i.local, row.id, d.key)) source = "workspace.local.toml";
        else if (setsKey(i.workspace, row.id, d.key)) source = "workspace.toml";
        else if (d.key in cfg) source = "bundle";
        values[d.key] = { value: d.key in cfg ? cfg[d.key] : (d.default ?? null), source };
      }
      sec.plugins.push({ plugin: row.id, label: pluginLabel(row.id), fields: mine.map(toField), values });
    }
  }
  return { sections };
}

/**
 * Set plugin `id`'s `key` in a parsed workspace.toml or workspace.local.toml: patch the last [[plugin]] row with that
 * id, or add `{ id, config }` (a patch row) when there is none. Every other key and row is kept.
 */
export function setInDoc(doc: Record<string, unknown>, id: string, key: string, value: unknown): Record<string, unknown> {
  const plugin = Array.isArray(doc.plugin) ? [...(doc.plugin as unknown[])] : [];
  let at = -1;
  plugin.forEach((r, n) => {
    if (isObj(r) && r.id === id) at = n;
  });
  if (at >= 0) {
    const r = plugin[at] as Record<string, unknown>;
    plugin[at] = { ...r, config: { ...(isObj(r.config) ? r.config : {}), [key]: value } };
  } else plugin.push({ id, config: { [key]: value } });
  return { ...doc, plugin };
}
