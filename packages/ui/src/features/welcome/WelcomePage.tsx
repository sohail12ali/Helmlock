// First run, rethought (Blueprint 34): a focused full-width wizard at /welcome. One question per screen, a three-part
// progress strip (You · Engines | Code · Crew | Phone · First task), Back always works, the draft survives a reload,
// and only Code and Phone can be skipped. It asks nothing it can detect (GET /setup/detect), repairs technical upkeep
// silently (POST /setup/upkeep, failures only), writes through the same verbs as Settings, and ends inside work:
// the first task becomes a ticket handed to a role, and the person lands on its thread.
import type { SetupDetect, SetupStatus, SetupStepId, SetupUpkeep } from "@helmlock/core/contracts";
import { Check, Moon, Sun } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useWorkspace } from "@/api/hooks";
import { useSetup } from "@/api/m5";
import { setupApi, useSetupDetect } from "@/api/setup";
import { ErrorState, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CrewScreen } from "./CrewScreen";
import { GROUPS, loadDraft, STEPS, saveDraft, startStep, type WelcomeDraft, type WizardStep } from "./draft";
import { EnginesScreen } from "./EnginesScreen";
import { CodeScreen, FirstTaskScreen, PhoneScreen, YouScreen } from "./screens";

interface WelcomeCtx {
  detect: SetupDetect;
  status: SetupStatus | null | undefined;
  draft: WelcomeDraft;
  patch: (p: Partial<WelcomeDraft>) => void;
  step: WizardStep;
  index: number;
  go: (id: SetupStepId) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const Ctx = createContext<WelcomeCtx | null>(null);

export function useWelcome(): WelcomeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWelcome outside the welcome wizard");
  return v;
}

// ---------- shared screen parts ----------

/** One question per screen: the heading is the question, the lead says why. */
export function Screen({ title, lead, children, footer }: { title: string; lead?: ReactNode; children?: ReactNode; footer: ReactNode }) {
  const { step } = useWelcome();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-label={`Step: ${step.label}`} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {GROUPS[step.group]} · {step.label}
          {step.skippable ? " (optional)" : ""}
        </p>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none sm:text-2xl">
          {title}
        </h1>
        {lead && <p className="text-sm text-ink2">{lead}</p>}
      </div>
      <div className="@container flex flex-col gap-4">{children}</div>
      {footer}
    </section>
  );
}

/** Back, Later (optional screens only) and Continue. Continue may be async; it moves on only when it returns true. */
export function Footer({
  canContinue = true,
  continueLabel = "Continue",
  busy = false,
  onContinue,
  hint,
}: {
  canContinue?: boolean;
  continueLabel?: string;
  busy?: boolean;
  onContinue?: () => Promise<boolean> | boolean;
  hint?: ReactNode;
}) {
  const { index, back, next, skip, step } = useWelcome();
  const [running, setRunning] = useState(false);
  const go = async () => {
    if (!onContinue) return next();
    setRunning(true);
    try {
      if (await onContinue()) next();
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={index === 0} onClick={back}>
          Back
        </Button>
        <span className="flex-1" />
        {step.skippable && (
          <Button variant="outline" onClick={skip} disabled={busy || running}>
            Later
          </Button>
        )}
        <Button onClick={() => void go()} disabled={!canContinue || busy || running}>
          {running ? "Saving" : continueLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------- progress ----------

function Progress({
  index,
  status,
  skipped,
  onPick,
}: {
  index: number;
  status: SetupStatus | null | undefined;
  skipped: SetupStepId[];
  onPick: (i: number) => void;
}) {
  const doneOf = (id: SetupStepId) => status?.steps.find((s) => s.id === id)?.done ?? false;
  return (
    <nav aria-label="Setup progress" className="border-b bg-sunk/40">
      <ol className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-2 px-4 py-3 sm:gap-4">
        {GROUPS.map((g, gi) => (
          <li key={g} className="flex min-w-0 flex-col gap-1.5">
            <span
              className={cn("truncate text-[11px] font-medium tracking-wide uppercase", STEPS[index]?.group === gi ? "text-primary" : "text-muted-foreground")}
            >
              {g}
            </span>
            <ol className="flex gap-1.5">
              {STEPS.map((s, i) =>
                s.group !== gi ? null : (
                  <li key={s.id} className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onPick(i)}
                      aria-current={i === index ? "step" : undefined}
                      aria-label={`${s.label}${doneOf(s.id) ? " (done)" : skipped.includes(s.id) ? " (skipped)" : ""}`}
                      className="flex w-full min-w-0 flex-col gap-1 text-left"
                    >
                      <span
                        className={cn(
                          "block h-1.5 rounded-full",
                          i === index ? "bg-primary" : doneOf(s.id) ? "bg-primary/50" : skipped.includes(s.id) ? "bg-warn/50" : "bg-border",
                        )}
                      />
                      <span className={cn("flex items-center gap-1 truncate text-xs", i === index ? "font-medium text-foreground" : "text-ink2")}>
                        {doneOf(s.id) && <Check className="size-3 shrink-0 text-ok" aria-hidden />}
                        <span className="truncate">{s.label}</span>
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function UpkeepNote({ upkeep }: { upkeep: SetupUpkeep | undefined }) {
  if (!upkeep?.failures.length) return null;
  return (
    <div role="status" className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
      <p className="font-medium">Some upkeep could not be done for you:</p>
      <ul className="mt-1 list-disc pl-5 text-ink2">
        {upkeep.failures.map((f) => (
          <li key={f.name}>
            {f.name}: {f.message}
            {f.fix ? ` (fix: ${f.fix})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- the wizard ----------

function Wizard({ detect }: { detect: SetupDetect }) {
  const setup = useSetup();
  const [draft, setDraft] = useState<WelcomeDraft>(() => loadDraft());
  const [current, setCurrent] = useState<SetupStepId>(() => startStep(draft, detect.you.author_known));
  const [upkeep, setUpkeep] = useState<SetupUpkeep>();
  const started = useRef(false);

  // Technical upkeep is not a step: repair it once when the wizard starts and show only what failed.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setupApi
      .upkeep()
      .then(setUpkeep)
      .catch(() => {});
  }, []);

  const index = Math.max(
    0,
    STEPS.findIndex((s) => s.id === current),
  );
  const ctx = useMemo<WelcomeCtx>(() => {
    const update = (fn: (d: WelcomeDraft) => WelcomeDraft) =>
      setDraft((d) => {
        const next = fn(d);
        saveDraft(next);
        return next;
      });
    const at = (i: number) => STEPS[Math.min(Math.max(i, 0), STEPS.length - 1)]!.id;
    const go = (id: SetupStepId) => {
      setCurrent(id);
      update((d) => ({ ...d, step: id }));
    };
    const id = STEPS[index]!.id;
    return {
      detect,
      status: setup.data,
      draft,
      patch: (p) => update((d) => ({ ...d, ...p })),
      step: STEPS[index]!,
      index,
      go,
      next: () => go(at(index + 1)),
      back: () => go(at(index - 1)),
      skip: () => {
        update((d) => ({ ...d, skipped: [...new Set([...(d.skipped ?? []), id])] }));
        go(at(index + 1));
      },
    };
  }, [detect, setup.data, draft, index]);

  const screen = {
    you: <YouScreen />,
    engine: <EnginesScreen />,
    code: <CodeScreen />,
    crew: <CrewScreen />,
    phone: <PhoneScreen />,
    "first-task": <FirstTaskScreen />,
  }[STEPS[index]!.id];

  return (
    <Ctx.Provider value={ctx}>
      <Progress index={index} status={setup.data} skipped={draft.skipped ?? []} onPick={(i) => ctx.go(STEPS[i]!.id)} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 sm:py-10">
        <UpkeepNote upkeep={upkeep} />
        <div key={STEPS[index]!.id}>{screen}</div>
      </main>
    </Ctx.Provider>
  );
}

export function WelcomePage() {
  const detect = useSetupDetect();
  const ws = useWorkspace();
  const { resolved, toggle } = useTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="font-semibold">Helmlock</span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">Set up {ws.data?.name ?? "this knowledge center"}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label={resolved === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>
          {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/">Exit to console</Link>
        </Button>
      </header>
      {detect.isPending ? (
        <div className="p-6">
          <Loading label="Looking at this machine" />
        </div>
      ) : detect.isError ? (
        <div className="mx-auto w-full max-w-2xl p-4">
          <ErrorState error={detect.error} />
        </div>
      ) : (
        <Wizard detect={detect.data} />
      )}
    </div>
  );
}
