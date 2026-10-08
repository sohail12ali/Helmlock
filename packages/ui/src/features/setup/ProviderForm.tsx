// Add a provider, trying it before it is saved: "Fetch models" (POST /models/try list_only) fills a checklist with
// what the server reports (context, tool use, vision, loaded: LM Studio's native list), "Test connection" runs the
// full probe on the first ticked model, and "Save" (after a successful fetch) calls `provider add` with every ticked
// model. The key field takes a variable name or the key itself: a pasted key is used only for Fetch and Test, and on
// Save goes to `secret set` (the machine's gitignored .env) so workspace.toml gets only the name.
// Used by the setup wizard's model step and Settings > Models.
import type { ModelProbe, ModelTry, VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ApiError } from "@/api/client";
import { m4 } from "@/api/m4";
import { addProvider, MODEL_QUERIES, type ModelProbeInfo, setSecret } from "@/api/m5";
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

export type ModelDetail = NonNullable<ModelProbe["model_info"]>[number];

/** 262144 -> "262k", 1048576 -> "1M". */
export function shortTokens(n: number): string {
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)}M`;
  if (n >= 1000) return `${Math.round(n / 1024)}k`;
  return String(n);
}

/** Loaded models first, then the server's order. */
export const sortModels = (list: ModelDetail[]) => [...list].sort((a, b) => Number(!!b.loaded) - Number(!!a.loaded));

/** The models a probe listed: the detailed list when there is one, else the plain ids. */
export const listedModels = (r: ModelProbe | undefined): ModelDetail[] => r?.model_info ?? r?.models.map((m) => ({ id: m })) ?? [];

/** Probe info to save on the model rows of the chosen models. */
export function probeInfoFor(names: string[], list: ModelDetail[], tested?: ModelProbe): ModelProbeInfo[] {
  const out: ModelProbeInfo[] = [];
  for (const id of names) {
    const info = list.find((m) => m.id === id);
    const t = tested && !tested.error && tested.model === id ? tested : undefined;
    const tool_calls = info?.tool_calls ?? t?.tool_calls;
    const row: ModelProbeInfo = { id };
    if (info?.context_window !== undefined) row.context_window = info.context_window;
    if (tool_calls !== undefined) row.tool_calls = tool_calls;
    if (info?.vision !== undefined) row.vision = info.vision;
    if (Object.keys(row).length > 1) out.push(row);
  }
  return out;
}

/** What the key field holds: nothing, an env-var name, or a pasted key. */
export function keyKind(value: string): "none" | "name" | "key" {
  const v = value.trim();
  if (!v) return "none";
  return ENV_NAME.test(v) ? "name" : "key";
}

/** The variable a pasted key is saved under: the preset's (OPENROUTER_API_KEY), else <PROVIDER_ID>_API_KEY. */
export function suggestedKeyName(preset: string, providerId: string): string {
  const p = PRESETS.find((x) => x.id === preset);
  if (p?.key_env) return p.key_env;
  const base = providerId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${/^[A-Z]/.test(base) ? base : `P_${base}`}_API_KEY`;
}

/** A checklist of a server's models (loaded first, capability chips). `taken` ones are shown ticked and locked. */
export function ModelChecklist({
  models,
  selected,
  onToggle,
  taken = [],
  label = "Models on the server",
}: {
  models: ModelDetail[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
  taken?: string[];
  label?: string;
}) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 max-h-72 flex-col overflow-y-auto rounded-md border">
      {sortModels(models).map((m) => {
        const locked = taken.includes(m.id);
        const on = locked || selected.includes(m.id);
        return (
          <label
            key={m.id}
            className={cn(
              "flex cursor-pointer flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent",
              on && "bg-accent",
              locked && "cursor-default opacity-70",
            )}
          >
            <input type="checkbox" value={m.id} checked={on} disabled={locked} onChange={(e) => onToggle(m.id, e.target.checked)} className="accent-primary" />
            <span className="min-w-0 break-all font-mono">{m.id}</span>
            {m.label && m.label !== m.id && <span className="text-xs text-muted-foreground">{m.label}</span>}
            <span className="flex flex-1 flex-wrap justify-end gap-1">
              {locked && <Badge variant="outline">added</Badge>}
              {m.loaded && <Badge variant="ok">loaded</Badge>}
              {m.context_window !== undefined && <Badge variant="outline">{shortTokens(m.context_window)} ctx</Badge>}
              {m.tool_calls && <Badge variant="accent">tools</Badge>}
              {m.vision && <Badge variant="accent">vision</Badge>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function ProviderForm({ cards = false, defaultPreset = "lmstudio", onSaved }: { cards?: boolean; defaultPreset?: string; onSaved?: () => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [preset, setPreset] = useState(PRESETS.some((x) => x.id === defaultPreset) ? defaultPreset : PRESETS[0]!.id);
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]!;
  const [id, setId] = useState(p.id === "custom" ? "" : p.id);
  const [baseUrl, setBaseUrl] = useState(p.base_url);
  // An env-var name or the key itself; a key is never sent anywhere but /models/try and `secret set`.
  const [key, setKey] = useState(p.key_env ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [list, setList] = useState<ModelProbe>();
  const [test, setTest] = useState<ModelProbe>();
  const [busy, setBusy] = useState<"fetch" | "test" | "save">();
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<{ result: VerbCallResult; models: string[]; secret?: string }>();

  const kind = keyKind(key);
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
    if (key === (p.key_env ?? "")) setKey(n.key_env ?? "");
    setPreset(n.id);
    stale();
  };

  const draft = (): ModelTry | undefined => {
    setProblem(undefined);
    if (!baseUrl.trim()) return void setProblem("Base URL is required, for example http://192.168.1.14:1234/v1.");
    const k = key.trim();
    return { base_url: baseUrl.trim(), preset, ...(kind === "name" ? { key_env: k } : kind === "key" ? { key: k } : {}) };
  };
  const call = async (what: "fetch" | "test", body: ModelTry): Promise<ModelProbe | undefined> => {
    setBusy(what);
    try {
      return await m4.tryProvider(body);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The console server is not reachable.");
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const chosen = (): string[] => {
    const out = [...selected];
    const typed = extra.trim();
    if (typed && !out.includes(typed)) out.push(typed);
    return out;
  };

  const fetchModels = async () => {
    const d = draft();
    if (!d) return;
    setTest(undefined);
    setSaved(undefined);
    const r = await call("fetch", { ...d, list_only: true });
    setList(r);
    if (!r?.reachable || r.error) return;
    const all = listedModels(r);
    const still = selected.filter((m) => all.some((x) => x.id === m));
    setSelected(still.length ? still : sortModels(all)[0] ? [sortModels(all)[0]!.id] : []);
  };
  const testConnection = async () => {
    const d = draft();
    if (!d) return;
    setTest(undefined);
    const first = chosen()[0];
    const r = await call("test", { ...d, ...(first ? { model: first } : {}) });
    setTest(r);
    if (r?.model && !first) setSelected([r.model]);
  };

  const fetched = !!list?.reachable && !list.error;
  const save = async () => {
    setProblem(undefined);
    const pid = id.trim();
    if (!SAVE_ID.test(pid)) return setProblem("Provider id: lowercase letters, digits and dashes, for example lmstudio.");
    const models = chosen();
    if (!models.length) return setProblem("Tick at least one model.");
    setBusy("save");
    try {
      let keyEnv = kind === "name" ? key.trim() : undefined;
      if (kind === "key") {
        // The key goes to this machine's .env first; the provider row then names it.
        const name = suggestedKeyName(preset, pid);
        const s = await setSecret({ name, value: key.trim() });
        if (!s.ok) return setSaved({ result: s, models });
        keyEnv = name;
        setKey(name);
      }
      const info = probeInfoFor(models, listedModels(list), test);
      const r = await addProvider({
        id: pid,
        preset,
        base_url: list?.base_url ?? baseUrl.trim(),
        ...(keyEnv ? { key_env: keyEnv } : {}),
        models,
        ...(info.length ? { model_info: info } : {}),
      });
      setSaved({ result: r, models, ...(kind === "key" && keyEnv ? { secret: keyEnv } : {}) });
      if (r.ok) {
        for (const k of MODEL_QUERIES) void qc.invalidateQueries({ queryKey: [k] });
        onSaved?.();
      }
    } catch {
      setSaved({
        result: { ok: false, code: 1, error: { rule: "offline", message: "The console server is not reachable.", fix: "start it with hl serve" } },
        models,
      });
    } finally {
      setBusy(undefined);
    }
  };

  const listed = listedModels(list);
  const count = chosen().length;

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
        <Field
          label="API key"
          htmlFor={`${uid}-key`}
          hint={
            kind === "key"
              ? `The key is saved only on this machine, in .env, which git ignores; workspace.toml gets only the name (${suggestedKeyName(preset, id)}).`
              : "Paste the key, or type the name of an environment variable that holds it (such as OPENROUTER_API_KEY)."
          }
        >
          <Input
            id={`${uid}-key`}
            className="font-mono"
            type={kind === "key" ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
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
          <Button type="button" disabled={!fetched || count === 0 || !!busy} onClick={() => void save()}>
            {busy === "save" ? "Saving" : count > 1 ? `Save ${count} models` : "Save"}
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
            {listed.length} model{listed.length === 1 ? "" : "s"} at <Mono>{list?.base_url ?? baseUrl}</Mono>; tick every one you want to use. Test connection
            tries the first ticked one.
          </p>
          {listed.length > 0 && (
            <ModelChecklist
              models={listed}
              selected={selected}
              onToggle={(m, on) => setSelected((s) => (on ? (s.includes(m) ? s : [...s, m]) : s.filter((x) => x !== m)))}
            />
          )}
          <Field label="Another model" htmlFor={`${uid}-model-id`} hint="As the server names it, when it is not in the list.">
            <Input id={`${uid}-model-id`} className="font-mono" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
        </div>
      )}
      {test && <ProbeView r={test} />}
      {saved && !saved.result.ok && <VerbResult result={saved.result} />}
      {saved?.result.ok && (
        <p className="text-sm text-ok" role="status">
          Provider saved with {saved.models.length} model{saved.models.length === 1 ? "" : "s"}:{" "}
          <Mono>{saved.models.map((m) => (m.startsWith(`${id.trim()}/`) ? m : `${id.trim()}/${m}`)).join(", ")}</Mono>
          {saved.secret && (
            <>
              {" "}
              (key saved on this machine as <Mono>{saved.secret}</Mono>)
            </>
          )}
        </p>
      )}
    </div>
  );
}
