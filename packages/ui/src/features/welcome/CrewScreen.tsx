// Crew screen: the six roles with the engine each will use, preset from what passed on the Engines screen (an agent CLI
// for the build roles, a model on the Helmlock loop for the analysis roles when one is configured). Any can be changed;
// Continue saves the changed roles with `crew set`, the same verb Settings and the Crew page use.
import type { VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useModels } from "@/api/m4";
import { useCrew } from "@/api/m8";
import { callVerb } from "@/api/verbs";
import { Loading } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { VerbResult } from "@/components/forms/VerbResult";
import { type CrewChoice, presetCrew } from "./draft";
import { Footer, Screen, useWelcome } from "./WelcomePage";

function RoleRow({
  role,
  choice,
  engines,
  models,
  onChange,
}: {
  role: { id: string; label: string; description?: string };
  choice: CrewChoice;
  engines: { id: string; label: string }[];
  models: string[];
  onChange: (c: CrewChoice) => void;
}) {
  const uid = useId();
  return (
    <li className="grid grid-cols-1 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-medium">{role.label}</p>
        {role.description && <p className="line-clamp-2 text-xs text-muted-foreground">{role.description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`${uid}-engine`}>
          {role.label} engine
        </label>
        <Select
          id={`${uid}-engine`}
          className="w-40"
          value={choice.engine}
          onChange={(e) =>
            onChange(e.target.value === "loop" ? { engine: "loop", ...(models[0] ? { model: choice.model ?? models[0] } : {}) } : { engine: e.target.value })
          }
        >
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
          {!engines.some((e) => e.id === choice.engine) && <option value={choice.engine}>{choice.engine}</option>}
        </Select>
        {choice.engine === "loop" && (
          <>
            <label className="sr-only" htmlFor={`${uid}-model`}>
              {role.label} model
            </label>
            <Select
              id={`${uid}-model`}
              className="w-56 font-mono"
              value={choice.model ?? ""}
              onChange={(e) => onChange({ engine: "loop", model: e.target.value })}
            >
              {!models.length && <option value="">no model configured</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
    </li>
  );
}

export function CrewScreen() {
  const { detect, draft, patch } = useWelcome();
  const crew = useCrew();
  const models = useModels();
  const qc = useQueryClient();
  const [failed, setFailed] = useState<{ role: string; result: VerbCallResult }[]>([]);
  const roles = crew.data?.roles;
  const modelIds = models.data?.models.map((m) => m.id) ?? [];
  const modelsSettled = !models.isPending;

  // Preset once, from what passed on the Engines screen; the draft keeps the person's changes after that.
  useEffect(() => {
    if (!roles || !modelsSettled || draft.crew) return;
    patch({ crew: presetCrew(roles, detect, draft.tests, models.data?.default ?? detect.providers.default_model) });
  }, [roles, modelsSettled, draft.crew, detect, draft.tests, models.data?.default, patch]);

  const engines = detect.engines.filter((e) => e.found || e.id === "loop").map((e) => ({ id: e.id, label: e.label }));
  const choices = draft.crew ?? {};

  const save = async (): Promise<boolean> => {
    if (!roles) return true;
    const out: { role: string; result: VerbCallResult }[] = [];
    for (const r of roles) {
      const c = choices[r.id];
      if (!c) continue;
      const model = c.engine === "loop" ? c.model : undefined;
      if (c.engine === r.engine && (model ?? "") === (c.engine === "loop" ? (r.model ?? "") : "")) continue;
      const result = await callVerb("crew set", { role: r.id, engine: c.engine, ...(model ? { model } : {}) });
      if (!result.ok) out.push({ role: r.id, result });
    }
    setFailed(out);
    for (const k of ["crew", "setup"]) void qc.invalidateQueries({ queryKey: [k] });
    return out.length === 0;
  };

  const ready = !!roles && roles.every((r) => choices[r.id]?.engine && (choices[r.id]?.engine !== "loop" || choices[r.id]?.model));
  return (
    <Screen
      title="Who does what?"
      lead="Each role of your crew runs on one engine. They are preset from what worked; change any of them now or later on the Crew page."
      footer={
        <Footer
          canContinue={crew.isError || ready}
          continueLabel={crew.isError ? "Continue" : "Save crew and continue"}
          onContinue={crew.isError ? undefined : save}
        />
      }
    >
      {crew.isPending ? (
        <Loading label="Loading the crew" />
      ) : crew.isError || !roles ? (
        <p className="text-sm text-muted-foreground">
          The crew could not be loaded here{crew.error instanceof Error ? ` (${crew.error.message})` : ""}. You can set it up later on the Crew page.
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="Crew roles">
          {roles.map((r) => {
            const c = choices[r.id] ?? { engine: r.engine, ...(r.model ? { model: r.model } : {}) };
            return (
              <RoleRow key={r.id} role={r} choice={c} engines={engines} models={modelIds} onChange={(next) => patch({ crew: { ...choices, [r.id]: next } })} />
            );
          })}
        </ul>
      )}
      {failed.map((f) => (
        <div key={f.role} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{f.role}</p>
          <VerbResult result={f.result} />
        </div>
      ))}
    </Screen>
  );
}
