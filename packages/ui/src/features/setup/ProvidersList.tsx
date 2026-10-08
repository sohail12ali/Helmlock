// Settings > Models: every saved provider with its models. Per model: make default (star) and remove; per provider:
// add more models (fetched from the provider's own server via /models/try with its saved base URL and key name) and
// remove. Removals are confirmed inside the page (no browser dialogs); removing the default names the new one.
import type { ModelInfo, ModelProbe, ModelsView, ProviderInfo, VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "@/api/client";
import { m4, useModels } from "@/api/m4";
import { addModels, MODEL_QUERIES, removeModel, removeProvider, setDefaultModel } from "@/api/m5";
import { ErrorState, Loading, Mono } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { VerbResult } from "@/components/forms/VerbResult";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityChips, groupModels } from "@/features/chat/ModelPicker";
import { ProbeError } from "@/features/chat/ModelsTest";
import { listedModels, ModelChecklist, probeInfoFor } from "./ProviderForm";

const OFFLINE: VerbCallResult = {
  ok: false,
  code: 1,
  error: { rule: "offline", message: "The console server is not reachable.", fix: "start it with hl serve" },
};

/** Run one verb call, refresh the model queries on success, and keep the result for inline display. */
function useModelWrite() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<VerbCallResult>();
  const run = async (fn: () => Promise<VerbCallResult>): Promise<VerbCallResult> => {
    setBusy(true);
    let r: VerbCallResult;
    try {
      r = await fn();
    } catch {
      r = OFFLINE;
    }
    setBusy(false);
    setLast(r);
    if (r.ok) for (const k of MODEL_QUERIES) void qc.invalidateQueries({ queryKey: [k] });
    return r;
  };
  return { run, busy, last, clear: () => setLast(undefined) };
}

/** "Remove <model>?" with the new default picked here when the model is the default. */
function ConfirmModelRemove({ model, view, onDone }: { model: ModelInfo; view: ModelsView; onDone: () => void }) {
  const uid = useId();
  const w = useModelWrite();
  const others = view.models.filter((m) => m.id !== model.id);
  const isDefault = view.default === model.id;
  const [next, setNext] = useState(others[0]?.id ?? "");
  const go = async () => {
    const r = await w.run(() => removeModel({ id: model.id, ...(isDefault ? { default: next } : {}) }));
    if (r.ok) onDone();
  };
  return (
    <fieldset
      aria-label={`Confirm removing ${model.id}`}
      className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <p>
        Remove <Mono>{model.id}</Mono> from workspace.toml?
      </p>
      {isDefault &&
        (others.length ? (
          <label htmlFor={`${uid}-next`} className="flex flex-wrap items-center gap-2">
            It is the default model. New default:
            <Select id={`${uid}-next`} value={next} onChange={(e) => setNext(e.target.value)} className="h-7 w-auto max-w-xs text-xs">
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <p className="text-ink2">It is the only model and the default; remove its provider instead, or add another model first.</p>
        ))}
      <div className="flex gap-2">
        <Button size="sm" disabled={w.busy || (isDefault && !others.length)} onClick={() => void go()}>
          Remove
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {w.last && !w.last.ok && <VerbResult result={w.last} />}
    </fieldset>
  );
}

function ConfirmProviderRemove({ provider, models, view, onDone }: { provider: ProviderInfo; models: ModelInfo[]; view: ModelsView; onDone: () => void }) {
  const w = useModelWrite();
  const mine = new Set(models.map((m) => m.id));
  const holdsDefault = !!view.default && mine.has(view.default);
  const nextDefault = view.models.find((m) => !mine.has(m.id))?.id;
  const go = async () => {
    const r = await w.run(() => removeProvider({ id: provider.id, ...(holdsDefault ? { force: true } : {}) }));
    if (r.ok) onDone();
  };
  return (
    <fieldset
      aria-label={`Confirm removing provider ${provider.id}`}
      className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <p>
        Remove provider <Mono>{provider.id}</Mono> and its {models.length} model{models.length === 1 ? "" : "s"} from workspace.toml?
      </p>
      {holdsDefault && (
        <p className="text-ink2">
          It holds the default model.{" "}
          {nextDefault ? (
            <>
              The default moves to <Mono>{nextDefault}</Mono>.
            </>
          ) : (
            "No default model will be left."
          )}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={w.busy} onClick={() => void go()}>
          Remove provider
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {w.last && !w.last.ok && <VerbResult result={w.last} />}
    </fieldset>
  );
}

/** Fetch the provider's list with its saved base URL and key name, then tick models to add. */
function AddModels({ provider, models, onDone }: { provider: ProviderInfo; models: ModelInfo[]; onDone: () => void }) {
  const w = useModelWrite();
  const [list, setList] = useState<ModelProbe>();
  const [problem, setProblem] = useState<string>();
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const taken = models.map((m) => m.id.slice(provider.id.length + 1));
  const fetchList = async () => {
    setProblem(undefined);
    setFetching(true);
    try {
      setList(
        await m4.tryProvider({
          base_url: provider.base_url,
          list_only: true,
          ...(provider.preset ? { preset: provider.preset } : {}),
          ...(provider.key_env ? { key_env: provider.key_env } : {}),
        }),
      );
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The console server is not reachable.");
    } finally {
      setFetching(false);
    }
  };
  const listed = listedModels(list);
  const ok = !!list?.reachable && !list.error;
  const save = async () => {
    const info = probeInfoFor(selected, listed);
    const r = await w.run(() => addModels({ provider: provider.id, models: selected, ...(info.length ? { model_info: info } : {}) }));
    if (r.ok) onDone();
  };
  return (
    <fieldset aria-label={`Add models to ${provider.id}`} className="flex flex-col gap-2 rounded-md border bg-sunk/40 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={ok ? "outline" : "default"} disabled={fetching} onClick={() => void fetchList()}>
          {fetching ? "Fetching" : "Fetch models"}
        </Button>
        <Button size="sm" disabled={!selected.length || w.busy} onClick={() => void save()}>
          {selected.length > 1 ? `Add ${selected.length} models` : "Add"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">
          from <Mono>{provider.base_url}</Mono>
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      {list && !ok && (list.error ? <ProbeError error={list.error} /> : <p>The server did not answer.</p>)}
      {ok && listed.length > 0 && (
        <ModelChecklist
          models={listed}
          taken={taken}
          selected={selected}
          onToggle={(m, on) => setSelected((s) => (on ? (s.includes(m) ? s : [...s, m]) : s.filter((x) => x !== m)))}
          label={`Models on ${provider.id}`}
        />
      )}
      {w.last && !w.last.ok && <VerbResult result={w.last} />}
    </fieldset>
  );
}

type Open = { kind: "model"; id: string } | { kind: "provider"; id: string } | { kind: "add"; id: string } | undefined;

export function ProvidersList() {
  const q = useModels();
  const star = useModelWrite();
  const [open, setOpen] = useState<Open>();
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const view = q.data;
  if (!view.providers.length) return <p className="text-sm text-muted-foreground">No provider yet. Add one below.</p>;
  const groups = new Map(groupModels(view).map((g) => [g.provider, g.models]));
  const close = () => setOpen(undefined);
  return (
    <div className="flex flex-col gap-2" data-testid="providers-list">
      {view.providers.map((p) => {
        const models = groups.get(p.id) ?? [];
        return (
          <section key={p.id} aria-label={`Provider ${p.id}`} className="flex flex-col gap-1.5 rounded-md border px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{p.label || p.id}</p>
              <Mono className="text-xs text-muted-foreground">{p.id}</Mono>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={p.base_url}>
                {p.base_url}
                {p.key_env ? ` · key ${p.key_env}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setOpen({ kind: "add", id: p.id })}>
                Add models
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove provider ${p.id}`} onClick={() => setOpen({ kind: "provider", id: p.id })}>
                Remove
              </Button>
            </div>
            {open?.kind === "add" && open.id === p.id && <AddModels provider={p} models={models} onDone={close} />}
            {open?.kind === "provider" && open.id === p.id && <ConfirmProviderRemove provider={p} models={models} view={view} onDone={close} />}
            {models.length === 0 ? (
              <p className="text-xs text-muted-foreground">No models; use Add models.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {models.map((m) => {
                  const isDefault = view.default === m.id;
                  return (
                    <li key={m.id} className="flex flex-col gap-1.5 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-pressed={isDefault}
                          aria-label={isDefault ? `${m.id} is the default model` : `Make ${m.id} the default model`}
                          title={isDefault ? "Default model" : "Make default"}
                          disabled={star.busy}
                          onClick={() => {
                            if (!isDefault) void star.run(() => setDefaultModel(m.id));
                          }}
                        >
                          <Star className={isDefault ? "size-4 fill-current text-primary" : "size-4"} aria-hidden />
                        </Button>
                        <span className="min-w-0 break-all font-mono text-xs">{m.id}</span>
                        {isDefault && <Badge variant="accent">default</Badge>}
                        {m.context_window !== undefined && <Badge variant="outline">{Math.round(m.context_window / 1024)}k ctx</Badge>}
                        <CapabilityChips model={m} />
                        <span className="flex-1" />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${m.id}`}
                          title="Remove"
                          onClick={() => setOpen({ kind: "model", id: m.id })}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                      {open?.kind === "model" && open.id === m.id && <ConfirmModelRemove model={m} view={view} onDone={close} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {star.last && !star.last.ok && <VerbResult result={star.last} />}
    </div>
  );
}
