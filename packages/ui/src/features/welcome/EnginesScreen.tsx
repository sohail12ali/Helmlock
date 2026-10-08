// Engines screen: what was found on this machine. Agent CLIs (Claude Code, Cursor) with their version and a real
// "say hello" test; model providers whose key is already in the environment or .env, or a local LM Studio / Ollama
// that answers, added in one click (provider add with the preset and the key NAME, then the first model becomes the
// default; another one can be picked); "Other provider" opens the regular provider form. Continue needs one engine
// whose test passed or a configured model.
import type { SetupCheck, SetupDetect, SetupEngineTest, SetupProviderCandidate, VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cpu, Plus, Server, Terminal, XCircle } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "@/api/client";
import { m4, useModels } from "@/api/m4";
import { addModels, addProvider, MODEL_QUERIES, setDefaultModel } from "@/api/m5";
import { setupApi } from "@/api/setup";
import { Mono } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { VerbResult } from "@/components/forms/VerbResult";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { listedModels, ProviderForm, sortModels } from "@/features/setup/ProviderForm";
import { cn } from "@/lib/utils";
import { hasUsableEngine } from "./draft";
import { Footer, Screen, useWelcome } from "./WelcomePage";

const LEVEL = {
  info: { icon: CheckCircle2, cls: "text-ok", label: "ok" },
  warn: { icon: AlertTriangle, cls: "text-warn", label: "warning" },
  error: { icon: XCircle, cls: "text-destructive", label: "error" },
} as const;

export function Checks({ checks, label }: { checks: SetupCheck[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5 text-sm">
      {checks.map((c) => {
        const L = LEVEL[c.level];
        return (
          <li key={`${c.code}-${c.message}`} className="flex gap-2" data-code={c.code}>
            <L.icon className={cn("mt-0.5 size-4 shrink-0", L.cls)} aria-label={L.label} />
            <span className="min-w-0">
              <span className="[overflow-wrap:anywhere]">{c.message}</span>
              {c.hint && <span className="block text-xs text-muted-foreground">{c.hint}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const tile = "flex flex-col gap-2 rounded-lg border bg-card p-3";

function CliTile({ engine }: { engine: SetupDetect["engines"][number] }) {
  const { patch, draft } = useWelcome();
  const qc = useQueryClient();
  const [result, setResult] = useState<SetupEngineTest | undefined>(engine.last);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const test = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await setupApi.testEngine({ engine: engine.id });
      setResult(r);
      patch({ tests: { ...(draft.tests ?? {}), [engine.id]: r.ok } });
      void qc.invalidateQueries({ queryKey: ["setup"], exact: true });
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The console server is not reachable.");
    } finally {
      setBusy(false);
    }
  };
  const passed = result?.ok;
  return (
    <li className={cn(tile, passed && "border-ok/50")} aria-label={engine.label}>
      <div className="flex flex-wrap items-center gap-3">
        <Terminal className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{engine.label}</p>
          <p className="truncate text-xs text-muted-foreground">{engine.found ? (engine.version ?? "found on this machine") : "not found on this machine"}</p>
        </div>
        {passed !== undefined && <Badge variant={passed ? "ok" : "warn"}>{passed ? "works" : "not ready"}</Badge>}
        <Button size="sm" variant={passed ? "outline" : "default"} disabled={busy} onClick={() => void test()}>
          {busy ? "Saying hello" : result ? "Test again" : "Test"}
        </Button>
      </div>
      {busy && <p className="text-xs text-muted-foreground">Asking {engine.label} to say hello; this can take up to a minute.</p>}
      {result && <Checks checks={result.checks} label={`${engine.label} checks`} />}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </li>
  );
}

const sourceText = (c: SetupProviderCandidate) =>
  c.source === "running"
    ? `running on this machine${c.models?.length ? `, ${c.models.length} model${c.models.length === 1 ? "" : "s"}` : ""}`
    : c.source === ".env"
      ? `key found in this machine's .env (${c.key_env})`
      : `key found in the environment (${c.key_env})`;

const verbFail = (message: string): VerbCallResult => ({ ok: false, code: 1, error: { rule: "provider", message } });

function CandidateTile({ c }: { c: SetupProviderCandidate }) {
  const uid = useId();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<VerbCallResult>();
  const [added, setAdded] = useState<{ provider: string; models: string[]; current: string }>();
  // Not the detection itself: this tile stays (with its default-model pick) instead of turning into a configured row.
  const refresh = () => {
    for (const k of MODEL_QUERIES) void qc.invalidateQueries({ queryKey: [k], exact: k === "setup" });
  };

  // One click: list the models (a running local server already did), add the provider with the first one, make it the default.
  const add = async () => {
    setBusy(true);
    setFailed(undefined);
    try {
      let names = c.models ?? [];
      let base = c.base_url;
      if (!names.length) {
        const r = await m4.tryProvider({ base_url: c.base_url, preset: c.preset, ...(c.key_env ? { key_env: c.key_env } : {}), list_only: true });
        if (!r.reachable || r.error) return setFailed(verbFail(r.error?.message ?? `${c.label} did not answer`));
        names = sortModels(listedModels(r)).map((m) => m.id);
        base = r.base_url ?? base;
      }
      const first = names[0];
      if (!first) return setFailed(verbFail(`${c.label} lists no models`));
      const res = await addProvider({ id: c.preset, preset: c.preset, base_url: base, ...(c.key_env ? { key_env: c.key_env } : {}), models: [first] });
      if (!res.ok) return setFailed(res);
      const id = (res.data as { models?: string[] } | undefined)?.models?.[0] ?? `${c.preset}/${first}`;
      const def = await setDefaultModel(id);
      if (!def.ok) setFailed(def);
      setAdded({ provider: c.preset, models: names, current: first });
      refresh();
    } catch (e) {
      setFailed(verbFail(e instanceof ApiError ? e.message : "The console server is not reachable."));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (model: string) => {
    if (!added) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const r = await addModels({ provider: added.provider, models: [model] });
      if (!r.ok) return setFailed(r);
      const id = `${added.provider}/${model}`;
      const def = await setDefaultModel(id);
      if (!def.ok) return setFailed(def);
      setAdded({ ...added, current: model });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const Icon = c.source === "running" ? Server : Cpu;
  return (
    <li className={cn(tile, added && "border-ok/50")} aria-label={c.label}>
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{c.label}</p>
          <p className="truncate text-xs text-muted-foreground">{sourceText(c)}</p>
        </div>
        {added ? (
          <Badge variant="ok">added</Badge>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void add()}>
            {busy ? "Adding" : `Add ${c.label.replace(/ \(local\)$/, "")}`}
          </Button>
        )}
      </div>
      {added && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`${uid}-model`} className="text-ink2">
            Default model
          </label>
          <Select id={`${uid}-model`} className="max-w-xs font-mono" value={added.current} disabled={busy} onChange={(e) => void pick(e.target.value)}>
            {added.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      )}
      {failed && <VerbResult result={failed} />}
    </li>
  );
}

export function EnginesScreen() {
  const { detect, draft } = useWelcome();
  const models = useModels();
  const qc = useQueryClient();
  const [other, setOther] = useState(false);
  const clis = detect.engines.filter((e) => e.id !== "loop");
  const configured = detect.providers.configured;
  const modelCount = models.data?.models.length ?? 0;
  const usable = hasUsableEngine(detect, draft.tests) || modelCount > 0;

  return (
    <Screen
      title="Which engines can do the work?"
      lead="Agents run on an agent CLI on this machine, or on a model through a provider. Test what was found, or add a model; one that works is enough to start."
      footer={<Footer canContinue={usable} hint={usable ? undefined : "Test an engine that says hello, or add a model, to continue."} />}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Agent CLIs</h2>
        {clis.length ? (
          <ul className="grid gap-2">
            {clis.map((e) => (
              <CliTile key={e.id} engine={e} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No agent CLI is registered in this workspace.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Models</h2>
        <ul className="grid gap-2">
          {configured.map((p) => (
            <li key={p.id} className={cn(tile, "flex-row flex-wrap items-center")} aria-label={p.label}>
              <Cpu className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.models} model{p.models === 1 ? "" : "s"}
                  {detect.providers.default_model?.startsWith(`${p.id}/`) && (
                    <>
                      {" "}
                      · default <Mono>{detect.providers.default_model}</Mono>
                    </>
                  )}
                </p>
              </div>
              <Badge variant="ok">configured</Badge>
            </li>
          ))}
          {detect.providers.candidates.map((c) => (
            <CandidateTile key={`${c.preset}-${c.source}`} c={c} />
          ))}
          <li>
            <Button variant="outline" onClick={() => setOther(true)}>
              <Plus className="size-4" aria-hidden />
              Other provider
            </Button>
          </li>
        </ul>
      </div>

      <Dialog open={other} onOpenChange={setOther}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle>Other provider</DialogTitle>
          <DialogDescription>Any OpenAI-style server: try it before it is saved. A pasted key stays on this machine.</DialogDescription>
          <div className="@container">
            <ProviderForm cards onSaved={() => void qc.invalidateQueries({ queryKey: ["setup"], exact: true })} />
          </div>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
