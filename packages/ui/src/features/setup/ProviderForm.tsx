// Add a provider, trying it before it is saved: "Fetch models" (POST /models/try list_only) fills a model picker with
// what the server reports (context, tool use, vision, loaded: LM Studio's native list), "Test connection" runs the
// full probe on the chosen model, and "Save" (after a successful fetch) calls `provider add` with what was found.
// Used by the setup wizard's model step and Settings > Models.
import type { ModelProbe, ModelTry, VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ApiError } from "@/api/client";
import { m4 } from "@/api/m4";
import { addProvider } from "@/api/m5";
import { Mono } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { VerbResult } from "@/components/forms/VerbResult";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProbeError, ProbeView } from "@/features/chat/ModelsTest";
import { cn } from "@/lib/utils";
import { ENV_NAME, PRESETS } from "./presets";

/** The provider id rule of `provider add`. */
const SAVE_ID = /^[a-z0-9][a-z0-9-]*$/;

type ModelDetail = NonNullable<ModelProbe["model_info"]>[number];

/** 262144 -> "262k", 1048576 -> "1M". */
export function shortTokens(n: number): string {
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)}M`;
  if (n >= 1000) return `${Math.round(n / 1024)}k`;
  return String(n);
}

/** Loaded models first, then the server's order. */
export const sortModels = (list: ModelDetail[]) => [...list].sort((a, b) => Number(!!b.loaded) - Number(!!a.loaded));

function ModelPicker({ models, value, onPick, name }: { models: ModelDetail[]; value: string; onPick: (id: string) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label="Models on the server" className="flex max-h-72 flex-col overflow-y-auto rounded-md border">
      {sortModels(models).map((m) => (
        <label
          key={m.id}
          className={cn(
            "flex cursor-pointer flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent",
            value === m.id && "bg-accent",
          )}
        >
          <input type="radio" name={name} value={m.id} checked={value === m.id} onChange={() => onPick(m.id)} className="accent-primary" />
          <span className="min-w-0 break-all font-mono">{m.id}</span>
          {m.label && m.label !== m.id && <span className="text-xs text-muted-foreground">{m.label}</span>}
          <span className="flex flex-1 flex-wrap justify-end gap-1">
            {m.loaded && <Badge variant="ok">loaded</Badge>}
            {m.context_window !== undefined && <Badge variant="outline">{shortTokens(m.context_window)} ctx</Badge>}
            {m.tool_calls && <Badge variant="accent">tools</Badge>}
            {m.vision && <Badge variant="accent">vision</Badge>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function ProviderForm({ cards = false, defaultPreset = "lmstudio", onSaved }: { cards?: boolean; defaultPreset?: string; onSaved?: () => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [preset, setPreset] = useState(PRESETS.some((x) => x.id === defaultPreset) ? defaultPreset : PRESETS[0]!.id);
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]!;
  const [id, setId] = useState(p.id === "custom" ? "" : p.id);
  const [baseUrl, setBaseUrl] = useState(p.base_url);
  const [keyEnv, setKeyEnv] = useState(p.key_env ?? "");
  const [model, setModel] = useState("");
  const [list, setList] = useState<ModelProbe>();
  const [test, setTest] = useState<ModelProbe>();
  const [busy, setBusy] = useState<"fetch" | "test" | "save">();
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<VerbCallResult>();

  /** Anything that changes the server makes the fetched list and the test stale. */
  const stale = () => {
    setList(undefined);
    setTest(undefined);
    setSaved(undefined);
  };
  const choose = (next: string) => {
    const n = PRESETS.find((x) => x.id === next) ?? PRESETS[0]!;
    // Keep what the person typed; follow the preset only where they kept the previous preset's value.
    if (id === (p.id === "custom" ? "" : p.id)) setId(n.id === "custom" ? "" : n.id);
    if (baseUrl === p.base_url) setBaseUrl(n.base_url);
    if (keyEnv === (p.key_env ?? "")) setKeyEnv(n.key_env ?? "");
    setPreset(n.id);
    stale();
  };

  const draft = (): ModelTry | undefined => {
    setProblem(undefined);
    if (!baseUrl.trim()) return void setProblem("Base URL is required, for example http://192.168.1.14:1234/v1.");
    if (keyEnv.trim() && !ENV_NAME.test(keyEnv.trim()))
      return void setProblem("Key: the NAME of an environment variable, such as OPENROUTER_API_KEY. The key itself stays in your environment.");
    return { base_url: baseUrl.trim(), preset, ...(keyEnv.trim() ? { key_env: keyEnv.trim() } : {}) };
  };
  const call = async (kind: "fetch" | "test", body: ModelTry): Promise<ModelProbe | undefined> => {
    setBusy(kind);
    try {
      return await m4.tryProvider(body);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The console server is not reachable.");
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const fetchModels = async () => {
    const d = draft();
    if (!d) return;
    setTest(undefined);
    setSaved(undefined);
    const r = await call("fetch", { ...d, list_only: true });
    setList(r);
    if (!r?.reachable || r.error) return;
    const all = r.model_info ?? r.models.map((m) => ({ id: m }));
    if (!all.some((m) => m.id === model)) setModel(sortModels(all)[0]?.id ?? "");
  };
  const testConnection = async () => {
    const d = draft();
    if (!d) return;
    setTest(undefined);
    const r = await call("test", { ...d, ...(model.trim() ? { model: model.trim() } : {}) });
    setTest(r);
    if (r?.model && !model.trim()) setModel(r.model);
  };

  const fetched = !!list?.reachable && !list.error;
  const save = async () => {
    setProblem(undefined);
    const pid = id.trim();
    if (!SAVE_ID.test(pid)) return setProblem("Provider id: lowercase letters, digits and dashes, for example lmstudio.");
    if (!model.trim()) return setProblem("Pick a model first.");
    const info = list?.model_info?.find((m) => m.id === model.trim());
    const tested = test?.model === model.trim() && !test.error ? test : undefined;
    const toolCalls = info?.tool_calls ?? tested?.tool_calls;
    setBusy("save");
    try {
      const r = await addProvider({
        id: pid,
        preset,
        base_url: list?.base_url ?? baseUrl.trim(),
        ...(keyEnv.trim() ? { key_env: keyEnv.trim() } : {}),
        model: model.trim(),
        ...(info?.context_window !== undefined ? { context_window: info.context_window } : {}),
        ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
        ...(info?.vision !== undefined ? { vision: info.vision } : {}),
      });
      setSaved(r);
      if (r.ok) {
        for (const k of ["models", "setup", "settings"]) void qc.invalidateQueries({ queryKey: [k] });
        onSaved?.();
      }
    } catch {
      setSaved({ ok: false, code: 1, error: { rule: "offline", message: "The console server is not reachable.", fix: "start it with hl serve" } });
    } finally {
      setBusy(undefined);
    }
  };

  const listed: ModelDetail[] = list?.model_info ?? list?.models.map((m) => ({ id: m })) ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid="provider-form">
      {cards && (
        <fieldset className="grid grid-cols-2 gap-2 @2xl:grid-cols-4" aria-label="Provider preset">
          {PRESETS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={preset === x.id}
              onClick={() => choose(x.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-primary/50",
                preset === x.id && "border-primary bg-accent",
              )}
            >
              <span className="font-medium">{x.label}</span>
              <span className="text-xs text-muted-foreground">{x.hint}</span>
            </button>
          ))}
        </fieldset>
      )}
      <form
        aria-label="Add a provider"
        className="grid grid-cols-1 gap-2 @2xl:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchModels();
        }}
      >
        <Field label="Preset" htmlFor={`${uid}-preset`}>
          <Select id={`${uid}-preset`} value={preset} onChange={(e) => choose(e.target.value)}>
            {PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider id" htmlFor={`${uid}-id`} required hint="Model ids become <provider id>/<model>.">
          <Input id={`${uid}-id`} className="font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="lmstudio" />
        </Field>
        <Field label="Base URL" htmlFor={`${uid}-url`} required hint="With or without /v1; another machine works too, for example http://192.168.1.14:1234.">
          <Input
            id={`${uid}-url`}
            className="font-mono"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              stale();
            }}
            placeholder="http://127.0.0.1:1234/v1"
          />
        </Field>
        <Field label="Key variable (name only)" htmlFor={`${uid}-key`} hint="The secret stays in your environment; only its variable name is saved.">
          <Input
            id={`${uid}-key`}
            className="font-mono"
            value={keyEnv}
            onChange={(e) => {
              setKeyEnv(e.target.value);
              stale();
            }}
            placeholder={p.key_env ?? "none for local servers"}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-2 @2xl:col-span-2">
          <Button type="submit" variant={fetched ? "outline" : "default"} disabled={!!busy}>
            {busy === "fetch" ? "Fetching" : "Fetch models"}
          </Button>
          <Button type="button" variant="outline" disabled={!!busy} onClick={() => void testConnection()}>
            {busy === "test" ? "Testing" : "Test connection"}
          </Button>
          <Button type="button" disabled={!fetched || !model.trim() || !!busy} onClick={() => void save()}>
            {busy === "save" ? "Saving" : "Save"}
          </Button>
          {!fetched && <span className="text-xs text-muted-foreground">Fetch models first; Save turns on once the server answers.</span>}
        </div>
      </form>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {list && !fetched && (
        <div className="rounded-md border bg-sunk p-2 text-xs" data-testid="fetch-result">
          {list.error ? <ProbeError error={list.error} /> : <p>The server did not answer.</p>}
        </div>
      )}
      {fetched && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            {listed.length} model{listed.length === 1 ? "" : "s"} at <Mono>{list?.base_url ?? baseUrl}</Mono>
          </p>
          {listed.length > 0 && <ModelPicker models={listed} value={model} onPick={(m) => setModel(m)} name={`${uid}-model`} />}
          <Field label="Model" htmlFor={`${uid}-model-id`} hint="As the server names it; pick above or type one.">
            <Input id={`${uid}-model-id`} className="font-mono" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
        </div>
      )}
      {test && <ProbeView r={test} />}
      {saved && !saved.ok && <VerbResult result={saved} />}
      {saved?.ok && (
        <p className="text-sm text-ok" role="status">
          Provider saved: <Mono>{`${id.trim()}/${model.trim()}`}</Mono>
        </p>
      )}
    </div>
  );
}
