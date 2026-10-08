// Several models at once (milestone 7): `model add`, `model remove`, `model default`, `provider remove` and the read
// verb `model list`. All edit the providers row of workspace.toml through the file layer (stale-write checked, dry run).
// Removing the default model needs an explicit new default (--default), so the default never moves silently;
// `provider remove --force` is the one exception and says where the default went.
import { type FileLayer, ok, type VerbCtx, type VerbDef } from "@helmlock/core";
import { z } from "zod";
import { probeInfo } from "./provider-add.ts";
import {
  infoFor,
  knownIds,
  type ModelProbeInfo,
  modelIdFor,
  modelRow,
  type ProvidersDoc,
  ROLE_KEYS,
  readProvidersDoc,
  WS_FILE,
  writeProvidersDoc,
} from "./providers-doc.ts";
import { SettingError } from "./settings.ts";

/** Clear role models (assistant_model, ...) that name a removed model; they fall back to the default. */
function clearRoles(cfg: Record<string, unknown>, removed: Set<string>): string[] {
  const cleared: string[] = [];
  for (const k of ROLE_KEYS)
    if (typeof cfg[k] === "string" && removed.has(cfg[k] as string)) {
      cfg[k] = undefined;
      cleared.push(k);
    }
  return cleared;
}

const providerOf = (d: ProvidersDoc, id: string) => {
  const p = d.providers.find((x) => x.id === id);
  if (!p)
    throw new SettingError(
      "config-bad-value",
      `no provider "${id}" in ${WS_FILE}`,
      `known providers: ${d.providers.map((x) => String(x.id)).join(", ") || "(none)"}; add one with \`hl provider add\``,
      WS_FILE,
    );
  return p;
};

const modelOf = (d: ProvidersDoc, id: string) => {
  const m = d.models.find((x) => x.id === id);
  if (!m)
    throw new SettingError(
      "config-bad-value",
      `no model "${id}" in ${WS_FILE}`,
      `model ids look like <provider>/<model>; known: ${knownIds(d.models)}`,
      WS_FILE,
    );
  return m;
};

// ---------- model add ----------

export interface ModelAddResult {
  provider: string;
  added: string[];
  skipped: string[];
  default_model: string;
  file: string;
  changed: boolean;
}

export async function addModels(
  files: FileLayer,
  kind: string,
  i: { provider: string; models: string[]; model_info?: ModelProbeInfo[] | undefined },
  opts: { dryRun?: boolean } = {},
): Promise<ModelAddResult> {
  const d = await readProvidersDoc(files, kind);
  providerOf(d, i.provider);
  const names = [...new Set(i.models.map((n) => n.trim()).filter(Boolean))];
  if (!names.length) throw new SettingError("config-bad-value", "give at least one model", `hl model add ${i.provider} <model>`);
  const models = [...d.models];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const n of names) {
    const id = modelIdFor(i.provider, n);
    if (models.some((m) => m.id === id)) {
      if (!skipped.includes(id)) skipped.push(id);
      continue;
    }
    models.push(modelRow(i.provider, n, infoFor(i.provider, n, i.model_info)));
    added.push(id);
  }
  const def = d.default_model ?? added[0];
  const changed = added.length ? await writeProvidersDoc(files, kind, d, { ...d.cfg, models, default_model: def }, opts) : false;
  return { provider: i.provider, added, skipped, default_model: def ?? "", file: WS_FILE, changed };
}

// ---------- model remove ----------

export interface ModelRemoveResult {
  removed: string;
  default_model: string;
  cleared_roles: string[];
  file: string;
  changed: boolean;
}

export async function removeModel(
  files: FileLayer,
  kind: string,
  i: { id: string; default?: string | undefined },
  opts: { dryRun?: boolean } = {},
): Promise<ModelRemoveResult> {
  const d = await readProvidersDoc(files, kind);
  modelOf(d, i.id);
  const rest = d.models.filter((m) => m.id !== i.id);
  let def = d.default_model;
  if (i.default !== undefined) {
    if (i.default === i.id)
      throw new SettingError("config-bad-value", `--default cannot be the model being removed (${i.id})`, `pick one of: ${knownIds(rest)}`);
    if (!rest.some((m) => m.id === i.default))
      throw new SettingError("config-bad-value", `--default "${i.default}" is not a configured model`, `pick one of: ${knownIds(rest)}`);
    def = i.default;
  } else if (d.default_model === i.id) {
    if (!rest.length)
      throw new SettingError(
        "config-bad-value",
        `${i.id} is the only model and the default`,
        `add another model first (\`hl model add\`), or remove its provider with \`hl provider remove <id> --force\``,
      );
    throw new SettingError(
      "config-bad-value",
      `${i.id} is the default model`,
      `name the new default: hl model remove ${i.id} --default <id> (one of: ${knownIds(rest)})`,
    );
  }
  const cfg: Record<string, unknown> = { ...d.cfg, models: rest, default_model: def };
  const cleared = clearRoles(cfg, new Set([i.id]));
  const changed = await writeProvidersDoc(files, kind, d, cfg, opts);
  return { removed: i.id, default_model: def ?? "", cleared_roles: cleared, file: WS_FILE, changed };
}

// ---------- model default ----------

export async function setDefaultModel(
  files: FileLayer,
  kind: string,
  id: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ default_model: string; previous: string; file: string; changed: boolean }> {
  const d = await readProvidersDoc(files, kind);
  modelOf(d, id);
  const changed = d.default_model === id ? false : await writeProvidersDoc(files, kind, d, { ...d.cfg, default_model: id }, opts);
  return { default_model: id, previous: d.default_model ?? "", file: WS_FILE, changed };
}

// ---------- provider remove ----------

export interface ProviderRemoveResult {
  provider: string;
  removed_models: string[];
  default_model: string;
  /** True when the default was one of the removed models and moved (or was cleared). */
  default_moved: boolean;
  cleared_roles: string[];
  file: string;
  changed: boolean;
}

export async function removeProvider(
  files: FileLayer,
  kind: string,
  i: { id: string; force?: boolean | undefined },
  opts: { dryRun?: boolean } = {},
): Promise<ProviderRemoveResult> {
  const d = await readProvidersDoc(files, kind);
  providerOf(d, i.id);
  const gone = d.models.filter((m) => m.provider === i.id || String(m.id).startsWith(`${i.id}/`));
  const goneIds = new Set(gone.map((m) => String(m.id)));
  const rest = d.models.filter((m) => !goneIds.has(String(m.id)));
  let def = d.default_model;
  const moved = def !== undefined && goneIds.has(def);
  if (moved) {
    if (!i.force)
      throw new SettingError(
        "config-bad-value",
        `provider ${i.id} holds the default model ${def}`,
        rest.length
          ? `make another model the default first (\`hl model default <id>\`, one of: ${knownIds(rest)}), or pass --force to move the default to ${String(rest[0]?.id)}`
          : "pass --force to remove it anyway; no default model will be left",
      );
    def = rest[0] ? String(rest[0].id) : undefined;
  }
  const cfg: Record<string, unknown> = { ...d.cfg, providers: d.providers.filter((p) => p.id !== i.id), models: rest, default_model: def };
  const cleared = clearRoles(cfg, goneIds);
  const changed = await writeProvidersDoc(files, kind, d, cfg, opts);
  return { provider: i.id, removed_models: [...goneIds], default_model: def ?? "", default_moved: moved, cleared_roles: cleared, file: WS_FILE, changed };
}

// ---------- model list ----------

export interface ModelListRow {
  id: string;
  provider: string;
  label: string;
  default: boolean;
}

// ---------- verbs ----------

const verb = (d: VerbDef): VerbDef => d;
const files = (v: VerbCtx) => v.ctx.get("files");
const would = (v: VerbCtx, done: string, dry: string) => (v.dryRun ? dry : done);
const rolesNote = (r: string[]) => (r.length ? `; cleared ${r.join(", ")} (they use the default now)` : "");

export function modelVerbs(kind: string): VerbDef[] {
  return [
    verb({
      id: "model add",
      summary: "Add one or more models to a saved provider in workspace.toml; models already there are skipped.",
      examples: ["hl model add openrouter anthropic/claude-sonnet-4 openai/gpt-4.1-mini", "hl model add lmstudio google/gemma-4-12b-qat --dry-run"],
      args: ["provider", "...models"],
      input: z.object({ provider: z.string().min(1), models: z.array(z.string().min(1)).min(1), model_info: z.array(probeInfo).optional() }),
      writes: true,
      async run(v, i: { provider: string; models: string[]; model_info?: ModelProbeInfo[] }) {
        const r = await addModels(files(v), kind, i, { dryRun: v.dryRun });
        const parts: string[] = [];
        if (r.added.length) parts.push(`${would(v, "added", "would add")} ${r.added.join(", ")}`);
        if (r.skipped.length) parts.push(`already there: ${r.skipped.join(", ")}`);
        return ok(r, `${parts.join("; ")}; default model ${r.default_model}`);
      },
    }),
    verb({
      id: "model remove",
      summary: "Remove one model from workspace.toml. Removing the default model needs --default <id> naming the new default.",
      examples: ["hl model remove openrouter/openai/gpt-4.1-mini", "hl model remove local/llama3.1 --default openrouter/anthropic/claude-sonnet-4"],
      args: ["id"],
      input: z.object({ id: z.string().min(1), default: z.string().min(1).optional() }),
      writes: true,
      async run(v, i: { id: string; default?: string }) {
        const r = await removeModel(files(v), kind, i, { dryRun: v.dryRun });
        return ok(r, `${would(v, "removed", "would remove")} ${r.removed}; default model ${r.default_model || "(none)"}${rolesNote(r.cleared_roles)}`);
      },
    }),
    verb({
      id: "model default",
      summary: "Set the default model (used for new chats and every role without its own model). It must be configured.",
      examples: ["hl model default openrouter/anthropic/claude-sonnet-4"],
      args: ["id"],
      input: z.object({ id: z.string().min(1) }),
      writes: true,
      async run(v, i: { id: string }) {
        const r = await setDefaultModel(files(v), kind, i.id, { dryRun: v.dryRun });
        const text =
          r.previous === r.default_model
            ? `unchanged: ${r.default_model} is already the default`
            : `${would(v, "default model is now", "would make default")} ${r.default_model}`;
        return ok(r, text);
      },
    }),
    verb({
      id: "provider remove",
      summary: "Remove a provider and its models from workspace.toml. Refuses when it holds the default model unless --force.",
      examples: ["hl provider remove openrouter", "hl provider remove local --force --dry-run"],
      args: ["id"],
      input: z.object({ id: z.string().min(1), force: z.boolean().optional() }),
      writes: true,
      async run(v, i: { id: string; force?: boolean }) {
        const r = await removeProvider(files(v), kind, i, { dryRun: v.dryRun });
        const models = r.removed_models.length
          ? ` and ${r.removed_models.length} model${r.removed_models.length === 1 ? "" : "s"} (${r.removed_models.join(", ")})`
          : "";
        const def = r.default_moved ? `; default model ${r.default_model ? `moved to ${r.default_model}` : "cleared (none left)"}` : "";
        return ok(r, `${would(v, "removed", "would remove")} provider ${r.provider}${models}${def}${rolesNote(r.cleared_roles)}`);
      },
    }),
    verb({
      id: "model list",
      summary: "List the configured models by provider; the default model is marked.",
      examples: ["hl model list", "hl model list --json"],
      input: z.object({}),
      writes: false,
      async run(v) {
        let rows: ModelListRow[];
        let def: string | undefined;
        if (v.ctx.has("providers")) {
          const p = v.ctx.get("providers");
          def = p.defaultModel();
          rows = p.models().map((m) => ({ id: m.id, provider: m.provider, label: m.label, default: m.id === def }));
        } else {
          const d = await readProvidersDoc(files(v), kind);
          def = d.default_model ?? (d.models[0] ? String(d.models[0].id) : undefined);
          rows = d.models.map((m) => ({ id: String(m.id), provider: String(m.provider ?? ""), label: String(m.label ?? m.id), default: m.id === def }));
        }
        const lines = rows.length
          ? rows.map((r) => `${r.default ? "*" : " "} ${r.id}${r.label && r.id !== `${r.provider}/${r.label}` ? `  (${r.label})` : ""}`)
          : ["no models; add one with hl provider add"];
        return ok({ models: rows, default: def ?? null }, lines.join("\n") + (rows.length ? "\n(* default)" : ""));
      },
    }),
  ];
}
