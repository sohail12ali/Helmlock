// `provider add`: append a provider row and its first model to the providers plugin config in workspace.toml
// (F11a: every endpoint is a row; F72 presets; F9b keys only by env-var name). Used by the setup wizard and the CLI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FileLayer, ok, type VerbCtx, type VerbDef } from "@helmlock/core";
import { parse } from "smol-toml";
import { z } from "zod";
import { SettingError, setInDoc } from "./settings.ts";

const PRESETS_DIR = join(import.meta.dirname, "..", "providers", "presets");
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ProviderAddInput {
  id: string;
  preset?: string | undefined;
  base_url?: string | undefined;
  key_env?: string | undefined;
  model: string;
  label?: string | undefined;
}

export interface ProviderAddResult {
  provider: string;
  model: string;
  base_url: string;
  default_model: string;
  file: string;
  changed: boolean;
}

function preset(name: string): Record<string, unknown> {
  try {
    return parse(readFileSync(join(PRESETS_DIR, `${name}.toml`), "utf8")) as Record<string, unknown>;
  } catch {
    throw new SettingError("config-bad-value", `unknown preset "${name}"`, "use ollama, lmstudio, vllm, llamacpp, openai, openrouter or custom");
  }
}

export async function addProvider(files: FileLayer, kind: string, i: ProviderAddInput, opts: { dryRun?: boolean } = {}): Promise<ProviderAddResult> {
  const rel = "workspace.toml";
  if (!(await files.exists(rel))) throw new SettingError("config", "no workspace.toml here", "run hl inside a knowledge repo", rel);
  const doc = await files.readToml<Record<string, unknown>>(rel, kind);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(i.id)) throw new SettingError("config-bad-value", `provider id "${i.id}" must be lowercase letters, digits and dashes`);
  if (i.key_env && !ENV_NAME.test(i.key_env))
    throw new SettingError("config-bad-value", "key_env must be an environment variable NAME (e.g. OPENAI_API_KEY), never the key itself");
  const p = i.preset ? preset(i.preset) : {};
  const base_url = i.base_url ?? (typeof p.base_url === "string" ? p.base_url : "");
  if (!/^https?:\/\//.test(base_url)) throw new SettingError("config-bad-value", "base_url must start with http:// or https://", "pass --base-url or a preset");

  const rows = Array.isArray(doc.data.plugin) ? (doc.data.plugin as unknown[]) : [];
  const row = rows.find((r) => isObj(r) && r.id === "providers") as Record<string, unknown> | undefined;
  const cfg = isObj(row?.config) ? (row.config as Record<string, unknown>) : {};
  const providers = Array.isArray(cfg.providers) ? [...(cfg.providers as unknown[])] : [];
  const models = Array.isArray(cfg.models) ? [...(cfg.models as unknown[])] : [];
  if (providers.some((x) => isObj(x) && x.id === i.id)) throw new SettingError("config-bad-value", `provider "${i.id}" already exists`, "pick another id");

  // Model ids are "<provider>/<model as the server names it>"; server names may contain "/" themselves (LM Studio).
  const modelId = i.model.startsWith(`${i.id}/`) ? i.model : `${i.id}/${i.model}`;
  const prov: Record<string, unknown> = { id: i.id, label: i.label ?? (typeof p.label === "string" ? p.label : i.id), base_url };
  if (i.preset) prov.preset = i.preset;
  if (i.key_env) prov.key_env = i.key_env;
  providers.push(prov);
  if (!models.some((m) => isObj(m) && m.id === modelId)) models.push({ id: modelId, provider: i.id, label: i.model });

  let next = setInDoc(doc.data, "providers", "providers", providers);
  next = setInDoc(next, "providers", "models", models);
  const defaultModel = typeof cfg.default_model === "string" && cfg.default_model ? cfg.default_model : modelId;
  next = setInDoc(next, "providers", "default_model", defaultModel);
  const res = await files.writeToml(rel, kind, next, { dryRun: opts.dryRun ?? false, expectHash: doc.hash });
  return { provider: i.id, model: modelId, base_url, default_model: defaultModel, file: rel, changed: res.changed };
}

export const providerAddVerb = (kind: string): VerbDef =>
  ({
    id: "provider add",
    summary: "Add an OpenAI-compatible provider and its first model to workspace.toml (key by env-var name only).",
    examples: [
      "hl provider add local --preset ollama --model llama3.1",
      "hl provider add openai --preset openai --key-env OPENAI_API_KEY --model gpt-4.1-mini",
    ],
    args: ["id"],
    input: z.object({
      id: z.string().min(1),
      preset: z.string().optional(),
      base_url: z.string().optional(),
      key_env: z.string().optional(),
      model: z.string().min(1),
      label: z.string().optional(),
    }),
    writes: true,
    async run(v: VerbCtx, i: ProviderAddInput) {
      const r = await addProvider(v.ctx.get("files"), kind, i, { dryRun: v.dryRun });
      const what = v.dryRun ? "would add" : "added";
      return ok(r, `${what} provider ${r.provider} (${r.base_url}) with model ${r.model}; default model ${r.default_model} (restart hl serve for the console)`);
    },
  }) as unknown as VerbDef;
