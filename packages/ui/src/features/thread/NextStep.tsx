// Mockup 15 note 1: Next step comes from the stage and the role map; one click hands the ticket to the right role on
// its engine. The engine chip overrides engine and model for this hand-off only. The ticket menu resets a session.
import type { EngineView, RunState, ThreadItem } from "@helmlock/core/contracts";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { useModels } from "@/api/m4";
import { useCrew, useHandoff, useNextStep, useResetSession, useThread } from "@/api/m8";
import { Mono } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { engineLabel, roleLabel, runPath } from "@/features/crew/bits";
import { cn } from "@/lib/utils";

/** Which role is "on" the ticket: the live run's, else the last run's. */
export function roleOnTicket(items: ThreadItem[], live?: RunState): string | undefined {
  if (live?.role) return live.role;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "run" && it.run.role) return it.run.role;
  }
  return undefined;
}

/** The loop engine picks from configured provider models; other engines take their own model names as text. */
export const LOOP_ENGINE = "loop";

export function ModelField({
  engine,
  value,
  onChange,
  placeholder,
  label = "Model",
}: {
  engine: EngineView | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const models = useModels();
  const uid = useId();
  if (!engine?.capabilities.models) return null;
  if (engine.id === LOOP_ENGINE)
    return (
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={uid}>
        {label}
        <Select id={uid} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholder ?? "Default"}</option>
          {(models.data?.models ?? []).map((m) => (
            <option key={`${m.provider}/${m.id}`} value={m.id}>
              {m.label ?? m.id} ({m.provider})
            </option>
          ))}
        </Select>
      </label>
    );
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={uid}>
      {label}
      <Input id={uid} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Default"} className="h-8" />
    </label>
  );
}

function EngineMenu({
  engines,
  engine,
  model,
  defaultModel,
  onEngine,
  onModel,
  onClose,
}: {
  engines: EngineView[];
  engine: string;
  model: string;
  defaultModel?: string;
  onEngine: (id: string) => void;
  onModel: (m: string) => void;
  onClose: () => void;
}) {
  const current = engines.find((e) => e.id === engine);
  return (
    <fieldset
      aria-label="Engine for this hand-off"
      className="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-2 text-sm shadow-lg"
    >
      <div className="flex flex-col gap-0.5">
        <p className="mb-1 text-xs text-muted-foreground">Engine (this hand-off only)</p>
        {engines.map((e) => {
          const problem = e.test.ok ? undefined : (e.test.checks.find((c) => c.level === "error")?.message ?? "engine test failed");
          return (
            <label key={e.id} className={cn("flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-accent", engine === e.id && "bg-accent")}>
              <input type="radio" name="engine" value={e.id} checked={engine === e.id} onChange={() => onEngine(e.id)} className="mt-1" />
              <span className="min-w-0">
                <span className="block">{e.label}</span>
                {problem ? <span className="block text-xs text-destructive">{problem}</span> : <span className="block text-xs text-ok">ready</span>}
              </span>
            </label>
          );
        })}
        {engines.length === 0 && <p className="text-xs text-muted-foreground">No engines reported by the server.</p>}
      </div>
      <ModelField engine={current} value={model} onChange={onModel} placeholder={defaultModel ? `Default (${defaultModel})` : "Default"} />
      <Button size="sm" variant="outline" className="self-end" onClick={onClose}>
        Done
      </Button>
    </fieldset>
  );
}

/** "Next step: Builder builds slice 2" plus the engine chip, the ticket menu, and what the hand-off started. */
export function NextStepBar({
  ticket,
  lastRole,
  onHandedOff,
  className,
}: {
  ticket: string;
  lastRole?: string;
  onHandedOff?: (r: RunState) => void;
  className?: string;
}) {
  const next = useNextStep(ticket);
  const thread = useThread(ticket);
  const crew = useCrew();
  const handoff = useHandoff();
  const reset = useResetSession();
  const [engine, setEngine] = useState<string>();
  const [model, setModel] = useState("");
  const [menu, setMenu] = useState<"engine" | "ticket" | null>(null);
  const [started, setStarted] = useState<RunState>();
  const [resetFor, setResetFor] = useState<string>();
  const engines = crew.data?.engines ?? [];
  const roles = crew.data?.roles;
  const step = next.data ?? null;
  const chosen = engine ?? step?.engine;
  const chosenView = engines.find((e) => e.id === chosen);
  const problem = chosenView && !chosenView.test.ok;
  const resetRole = lastRole ?? (thread.data ? roleOnTicket(thread.data.items, thread.data.live) : undefined) ?? step?.role;

  const go = () => {
    if (!step) return;
    const body = { role: step.role, ...(engine && engine !== step.engine ? { engine } : {}), ...(model && chosenView?.capabilities.models ? { model } : {}) };
    handoff.mutate(
      { ticket, body },
      {
        onSuccess: (r) => {
          setStarted(r);
          setEngine(undefined);
          setModel("");
          if (r) onHandedOff?.(r);
        },
      },
    );
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {step ? (
          <Button size="sm" onClick={go} disabled={handoff.isPending} title={step.reason}>
            <ArrowRight />
            {handoff.isPending ? "Handing off…" : `Next step: ${step.label}`}
          </Button>
        ) : next.isSuccess ? (
          <span className="text-xs text-muted-foreground">No next step for this ticket.</span>
        ) : null}
        {step && (
          <span className="relative">
            <button
              type="button"
              aria-label={`Engine: ${engineLabel(engines, chosen)}${model ? `, ${model}` : ""}`}
              aria-expanded={menu === "engine"}
              onClick={() => setMenu((m) => (m === "engine" ? null : "engine"))}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs",
                problem ? "border-destructive/50 text-destructive" : engine ? "border-primary bg-accent text-primary" : "text-ink2 hover:bg-accent",
              )}
            >
              {engineLabel(engines, chosen)}
              {(model || (!engine && step.model)) && <Mono className="text-muted-foreground">{model || step.model}</Mono>}
            </button>
            {menu === "engine" && (
              <EngineMenu
                engines={engines}
                engine={chosen ?? ""}
                model={model}
                defaultModel={step.model}
                onEngine={(id) => {
                  setEngine(id);
                  setModel("");
                }}
                onModel={setModel}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
        )}
        <span className="relative ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ticket menu"
            aria-expanded={menu === "ticket"}
            onClick={() => setMenu((m) => (m === "ticket" ? null : "ticket"))}
          >
            <MoreHorizontal />
          </Button>
          {menu === "ticket" && (
            <div role="menu" aria-label="Ticket menu" className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border bg-popover p-1 text-sm shadow-lg">
              <button
                type="button"
                role="menuitem"
                disabled={!resetRole || reset.isPending}
                onClick={() => {
                  if (!resetRole) return;
                  reset.mutate({ role: resetRole, ticket }, { onSuccess: () => setResetFor(resetRole) });
                  setMenu(null);
                }}
                className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              >
                Reset session
                <span className="text-xs text-muted-foreground">{resetRole ? `The ${resetRole} starts fresh next time` : "No role has worked here yet"}</span>
              </button>
            </div>
          )}
        </span>
      </div>
      {step && <p className="text-xs text-muted-foreground">{step.reason}</p>}
      {started && (
        <p role="status" className="text-xs text-ok">
          {roleLabel(started.role ?? step?.role, roles)} {started.status === "queued" ? "is queued" : "started"}:{" "}
          <Link to={runPath(started.id)} className="font-mono underline">
            {started.id}
          </Link>
        </p>
      )}
      {resetFor && (
        <p role="status" className="text-xs text-ok">
          Session reset for the {resetFor}.
        </p>
      )}
      {(handoff.isError || reset.isError) && (
        <p role="alert" className="text-xs text-destructive">
          {handoff.error instanceof ApiError ? handoff.error.message : reset.error instanceof ApiError ? reset.error.message : "Could not reach the server."}
        </p>
      )}
    </div>
  );
}
