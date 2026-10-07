// Provider and model tables (F11a, F72, F76). Read fresh from workspace.toml + workspace.local.toml on every call, so an
// edit applies with no restart. A provider row may name a preset (presets/*.toml) that fills base URL, auth and compat.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, ProviderInfo } from "@helmlock/core";
import { parse } from "smol-toml";

/** The compat switches we keep (Blueprint 12). Unknown keys are refused. */
export const COMPAT_KEYS = ["developer_role", "max_completion_tokens", "reasoning_effort", "usage_in_stream"] as const;
export type CompatKey = (typeof COMPAT_KEYS)[number];

export const ROLES = ["assistant", "summariser", "titles", "refiner"] as const;
export type Role = (typeof ROLES)[number];

export interface Preset {
  id: string;
  label: string;
  base_url: string;
  auth: "optional" | "required";
  key_env?: string;
  billing: "api" | "subscription" | "local";
  compat: Record<string, boolean>;
}

/** A resolved provider row: the contract shape plus the request policy. */
export interface ProviderRow extends ProviderInfo {
  auth: "optional" | "required";
  billing: "api" | "subscription" | "local";
  /** localhost / 127.0.0.1 / [::1]: longer timeouts (F75). */
  local: boolean;
  timeout_ms: number;
  retries: number;
  /** Extra JSON merged into every request body (e.g. Ollama options). */
  extra_body?: Record<string, unknown>;
}

export interface ProvidersConfig {
  providers: ProviderRow[];
  models: ModelInfo[];
  default_model?: string;
  roles: Partial<Record<Role, string>>;
  /** Rows refused while reading, with the reason (shown by the probe and logged). */
  problems: string[];
  /** Model ids whose row sets tool_calls itself; a probe never overrides those. */
  explicitCaps: Set<string>;
}

const PRESET_DIR = join(import.meta.dirname, "presets");
let presetCache: Map<string, Preset> | undefined;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function presets(): Map<string, Preset> {
  if (presetCache) return presetCache;
  const out = new Map<string, Preset>();
  for (const f of readdirSync(PRESET_DIR).filter((n) => n.endsWith(".toml"))) {
    const raw = parse(readFileSync(join(PRESET_DIR, f), "utf8")) as Record<string, unknown>;
    const id = str(raw.id) ?? f.replace(/\.toml$/, "");
    out.set(id, {
      id,
      label: str(raw.label) ?? id,
      base_url: typeof raw.base_url === "string" ? raw.base_url : "",
      auth: raw.auth === "required" ? "required" : "optional",
      ...(str(raw.key_env) ? { key_env: str(raw.key_env) as string } : {}),
      billing: raw.billing === "local" || raw.billing === "subscription" ? raw.billing : "api",
      compat: isObj(raw.compat) ? (Object.fromEntries(Object.entries(raw.compat).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>) : {},
    });
  }
  presetCache = out;
  return out;
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** Idle/first-byte timeout defaults (F75): local servers cold-load models, so they get longer. */
export const TIMEOUT_HOSTED_MS = 60_000;
export const TIMEOUT_LOCAL_MS = 300_000;

function providerRow(raw: unknown, problems: string[]): ProviderRow | undefined {
  if (!isObj(raw)) {
    problems.push("a providers entry is not a table");
    return undefined;
  }
  const id = str(raw.id);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
    problems.push(`provider ${JSON.stringify(raw.id)}: id must be letters, digits, dot, dash or underscore`);
    return undefined;
  }
  const presetId = str(raw.preset) ?? (presets().has(id) ? id : "custom");
  const preset = presets().get(presetId);
  if (!preset) {
    problems.push(`provider ${id}: unknown preset "${presetId}" (known: ${[...presets().keys()].join(", ")})`);
    return undefined;
  }
  const compatRaw = isObj(raw.compat) ? raw.compat : {};
  const bad = Object.keys(compatRaw).filter((k) => !(COMPAT_KEYS as readonly string[]).includes(k) || typeof compatRaw[k] !== "boolean");
  if (bad.length) {
    problems.push(`provider ${id}: unknown or non-boolean compat switch ${bad.join(", ")} (known: ${COMPAT_KEYS.join(", ")})`);
    return undefined;
  }
  const base_url = (str(raw.base_url) ?? preset.base_url).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base_url)) {
    problems.push(`provider ${id}: base_url must start with http:// or https://`);
    return undefined;
  }
  const keyEnv = str(raw.key_env) ?? preset.key_env;
  if (keyEnv && !/^[A-Z][A-Z0-9_]*$/.test(keyEnv)) {
    problems.push(`provider ${id}: key_env must be an environment variable NAME (F9b), not a key`);
    return undefined;
  }
  const local = isLocalUrl(base_url);
  const row: ProviderRow = {
    id,
    label: str(raw.label) ?? preset.label,
    base_url,
    preset: presetId,
    compat: { ...preset.compat, ...(compatRaw as Record<string, boolean>) },
    auth: raw.auth === "required" || raw.auth === "optional" ? raw.auth : preset.auth,
    billing: raw.billing === "api" || raw.billing === "subscription" || raw.billing === "local" ? raw.billing : local ? "local" : preset.billing,
    local,
    timeout_ms: typeof raw.timeout_ms === "number" && raw.timeout_ms > 0 ? raw.timeout_ms : local ? TIMEOUT_LOCAL_MS : TIMEOUT_HOSTED_MS,
    retries: typeof raw.retries === "number" && raw.retries >= 0 ? Math.floor(raw.retries) : local ? 2 : 3,
  };
  if (keyEnv) row.key_env = keyEnv;
  if (isObj(raw.extra_body)) row.extra_body = raw.extra_body;
  return row;
}

function modelRow(raw: unknown, providers: ProviderRow[], problems: string[], explicit: Set<string>): ModelInfo | undefined {
  if (!isObj(raw)) {
    problems.push("a models entry is not a table");
    return undefined;
  }
  let id = str(raw.id);
  let provider = str(raw.provider);
  if (!id) {
    problems.push("a model row needs an id");
    return undefined;
  }
  if (!provider) provider = id.split("/")[0];
  if (!provider || !providers.some((p) => p.id === provider)) {
    problems.push(`model ${id}: unknown provider ${JSON.stringify(provider)}`);
    return undefined;
  }
  if (!id.startsWith(`${provider}/`)) id = `${provider}/${id}`;
  const caps = isObj(raw.capabilities) ? raw.capabilities : raw;
  if (typeof caps.tool_calls === "boolean") explicit.add(id);
  const m: ModelInfo = {
    id,
    provider,
    label: str(raw.label) ?? id.slice(provider.length + 1),
    capabilities: {
      tool_calls: caps.tool_calls === true,
      vision: caps.vision === true,
      streaming: caps.streaming !== false,
    },
  };
  if (typeof raw.context_window === "number" && raw.context_window > 0) m.context_window = raw.context_window;
  if (typeof raw.max_tokens === "number" && raw.max_tokens > 0) m.max_tokens = raw.max_tokens;
  return m;
}

/** Turn the plugin row's config into the provider and model tables. Never throws; bad rows go to `problems`. */
export function readProvidersConfig(cfg: Record<string, unknown>): ProvidersConfig {
  const problems: string[] = [];
  const providers: ProviderRow[] = [];
  for (const r of Array.isArray(cfg.providers) ? cfg.providers : []) {
    const p = providerRow(r, problems);
    if (!p) continue;
    if (providers.some((x) => x.id === p.id)) problems.push(`provider ${p.id} is defined twice; the first row wins`);
    else providers.push(p);
  }
  const models: ModelInfo[] = [];
  const explicitCaps = new Set<string>();
  for (const r of Array.isArray(cfg.models) ? cfg.models : []) {
    const m = modelRow(r, providers, problems, explicitCaps);
    if (m && !models.some((x) => x.id === m.id)) models.push(m);
  }
  const roles: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const v = str(cfg[`${role}_model`]) ?? (isObj(cfg.roles) ? str(cfg.roles[role]) : undefined);
    if (v) roles[role] = v;
  }
  const out: ProvidersConfig = { providers, models, roles, problems, explicitCaps };
  const def = str(cfg.default_model);
  if (def) out.default_model = def;
  return out;
}

/** "ollama/qwen3:14b" -> the provider row and the model name sent on the wire ("qwen3:14b"). */
export function splitModelId(id: string, providers: ProviderRow[]): { provider: ProviderRow; wire: string } | undefined {
  // Longest provider id first, so "open/router" style ids never shadow each other.
  for (const p of [...providers].sort((a, b) => b.id.length - a.id.length))
    if (id.startsWith(`${p.id}/`) && id.length > p.id.length + 1) return { provider: p, wire: id.slice(p.id.length + 1) };
  return undefined;
}
