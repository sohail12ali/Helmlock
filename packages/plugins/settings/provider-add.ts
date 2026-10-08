// `provider add`: append a provider row and its models to the providers plugin config in workspace.toml
// (F11a: every endpoint is a row; F72 presets; F9b keys only by env-var name). Used by the setup wizard and the CLI.
// More models for a saved provider: `model add` (models.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FileLayer, ok, type VerbCtx, type VerbDef } from "@helmlock/core";
import { parse } from "smol-toml";
import { z } from "zod";
import { infoFor, type ModelProbeInfo, modelIdFor, modelRow, readProvidersDoc, writeProvidersDoc } from "./providers-doc.ts";
import { SettingError } from "./settings.ts";

const PRESETS_DIR = join(import.meta.dirname, "..", "providers", "presets");
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
export const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/;

export interface ProviderAddInput {
  id: string;
  preset?: string | undefined;
  base_url?: string | undefined;
  key_env?: string | undefined;
  /** One model (kept for older callers); `models` takes several. At least one of the two. */
  model?: string | undefined;
  models?: string[] | undefined;
  label?: string | undefined;
  /** What a probe found per model (try before save); written on the model rows. */
  model_info?: ModelProbeInfo[] | undefined;
  /** Probe info for the single `model` (older callers). */
  context_window?: number | undefined;
  tool_calls?: boolean | undefined;
  vision?: boolean | undefined;
}

export interface ProviderAddResult {
  provider: string;
  /** The first model added (older callers). */
  model: string;
  models: string[];
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

/** The model names of an input: `models` then `model`, without duplicates or blanks. */
export function namesOf(i: { model?: string | undefined; models?: string[] | undefined }): string[] {
  const out: string[] = [];
  for (const n of [...(i.models ?? []), ...(i.model ? [i.model] : [])]) {
    const t = n.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export async function addProvider(files: FileLayer, kind: string, i: ProviderAddInput, opts: { dryRun?: boolean } = {}): Promise<ProviderAddResult> {
  const d = await readProvidersDoc(files, kind);
  if (!PROVIDER_ID.test(i.id)) throw new SettingError("config-bad-value", `provider id "${i.id}" must be lowercase letters, digits and dashes`);
  if (i.key_env && !ENV_NAME.test(i.key_env))
    throw new SettingError(
      "config-bad-value",
      "key_env must be an environment variable NAME (e.g. OPENAI_API_KEY), never the key itself",
      "save the key with `hl secret set <NAME>` and pass that name",
    );
  const names = namesOf(i);
  if (!names.length) throw new SettingError("config-bad-value", "give at least one model", "pass --model <name> (repeatable as --models)");
  const p = i.preset ? preset(i.preset) : {};
  const base_url = i.base_url ?? (typeof p.base_url === "string" ? p.base_url : "");
  if (!/^https?:\/\//.test(base_url)) throw new SettingError("config-bad-value", "base_url must start with http:// or https://", "pass --base-url or a preset");
  if (d.providers.some((x) => x.id === i.id))
    throw new SettingError(
      "config-bad-value",
      `provider "${i.id}" already exists`,
      `add models to it with \`hl model add ${i.id} <model>\`, or pick another id`,
    );

  const prov: Record<string, unknown> = { id: i.id, label: i.label ?? (typeof p.label === "string" ? p.label : i.id), base_url };
  if (i.preset) prov.preset = i.preset;
  if (i.key_env) prov.key_env = i.key_env;
  const providers = [...d.providers, prov];
  const models = [...d.models];
  const added: string[] = [];
  const single = names.length === 1 && i.model ? { id: i.model, context_window: i.context_window, tool_calls: i.tool_calls, vision: i.vision } : undefined;
  for (const n of names) {
    const id = modelIdFor(i.id, n);
    added.push(id);
    if (models.some((m) => m.id === id)) continue;
    models.push(modelRow(i.id, n, infoFor(i.id, n, i.model_info) ?? (single && n === i.model ? single : undefined)));
  }
  const defaultModel = d.default_model ?? (added[0] as string);
  const changed = await writeProvidersDoc(files, kind, d, { ...d.cfg, providers, models, default_model: defaultModel }, opts);
  return { provider: i.id, model: added[0] as string, models: added, base_url, default_model: defaultModel, file: "workspace.toml", changed };
}

export const probeInfo = z.object({
  id: z.string().min(1),
  context_window: z.coerce.number().int().positive().optional(),
  tool_calls: z.boolean().optional(),
  vision: z.boolean().optional(),
});

export const providerAddVerb = (kind: string): VerbDef =>
  ({
    id: "provider add",
    summary: "Add an OpenAI-compatible provider and one or more of its models to workspace.toml (key by env-var name only).",
    examples: [
      "hl provider add local --preset ollama --model llama3.1",
      "hl provider add openai --preset openai --key-env OPENAI_API_KEY --models gpt-4.1-mini --models gpt-4.1",
    ],
    args: ["id"],
    input: z.object({
      id: z.string().min(1),
      preset: z.string().optional(),
      base_url: z.string().optional(),
      key_env: z.string().optional(),
      model: z.string().optional(),
      models: z.array(z.string().min(1)).optional(),
      label: z.string().optional(),
      model_info: z.array(probeInfo).optional(),
      context_window: z.coerce.number().int().positive().optional(),
      tool_calls: z.boolean().optional(),
      vision: z.boolean().optional(),
    }),
    writes: true,
    async run(v: VerbCtx, i: ProviderAddInput) {
      const r = await addProvider(v.ctx.get("files"), kind, i, { dryRun: v.dryRun });
      const what = v.dryRun ? "would add" : "added";
      const ms = r.models.length === 1 ? `model ${r.model}` : `models ${r.models.join(", ")}`;
      return ok(r, `${what} provider ${r.provider} (${r.base_url}) with ${ms}; default model ${r.default_model} (restart hl serve for the console)`);
    },
  }) as unknown as VerbDef;
