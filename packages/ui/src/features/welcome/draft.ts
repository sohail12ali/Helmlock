// The /welcome wizard's steps and its draft. The draft lives in localStorage (every access in try/catch) so a reload
// resumes on the same screen with what was typed; what was saved lives in the files and comes back from the server.
import type { SetupDetect, SetupStepId } from "@helmlock/core/contracts";

export interface WizardStep {
  id: SetupStepId;
  label: string;
  /** Index into GROUPS: the progress strip shows three parts. */
  group: number;
  /** Only Code and Phone can be skipped. */
  skippable: boolean;
}

export const GROUPS = ["Connect", "Organize", "Start"] as const;

export const STEPS: readonly WizardStep[] = [
  { id: "you", label: "You", group: 0, skippable: false },
  { id: "engine", label: "Engines", group: 0, skippable: false },
  { id: "code", label: "Code", group: 1, skippable: true },
  { id: "crew", label: "Crew", group: 1, skippable: false },
  { id: "phone", label: "Phone", group: 2, skippable: true },
  { id: "first-task", label: "First task", group: 2, skippable: false },
];

export const canSkip = (id: SetupStepId): boolean => STEPS.find((s) => s.id === id)?.skippable ?? false;

export interface CrewChoice {
  engine: string;
  model?: string;
}

export interface WelcomeDraft {
  step?: SetupStepId;
  /** The You form as typed (never sent until confirmed). */
  you?: { name: string; email: string; id: string; initials: string };
  /** Engine id -> its last on-demand test passed. */
  tests?: Record<string, boolean>;
  /** Role id -> the engine (and model) picked on the Crew screen. */
  crew?: Record<string, CrewChoice>;
  /** Screens skipped with "Later". */
  skipped?: SetupStepId[];
  task?: { text: string; project: string };
}

export const DRAFT_KEY = "hl.welcome.draft";
/** Set once per browser session when the console opened /welcome by itself. */
export const AUTO_KEY = "hl.welcome.auto";

export function loadDraft(): WelcomeDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as WelcomeDraft) : {};
  } catch {
    return {};
  }
}

export function saveDraft(d: WelcomeDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private window or storage full: the wizard still works, it just does not resume */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Where the wizard opens: the remembered screen, never You when this machine already knows its author. */
export function startStep(draft: WelcomeDraft, authorKnown: boolean): SetupStepId {
  const remembered = draft.step && STEPS.some((s) => s.id === draft.step) ? draft.step : undefined;
  if (remembered && !(remembered === "you" && authorKnown)) return remembered;
  return authorKnown ? "engine" : "you";
}

/** An engine is usable: an on-demand test passed (this session or the draft), or a provider has a model. */
export function hasUsableEngine(detect: SetupDetect | undefined, tests: Record<string, boolean> = {}): boolean {
  if (!detect) return false;
  if (Object.values(tests).some(Boolean)) return true;
  if (detect.engines.some((e) => e.last?.ok)) return true;
  return detect.providers.configured.some((p) => p.models > 0);
}

/** Roles that build and check code run on an agent CLI; the analysis roles prefer a model when one is configured. */
export const CLI_ROLES = new Set(["builder", "fixer", "verifier", "deployer"]);
export const MODEL_ROLES = new Set(["analyst", "planner"]);
const CLI_ORDER = ["claude-code", "cursor"];

/** The CLI engine the crew should use: one whose test passed, else one that was found. */
export function pickCli(detect: SetupDetect | undefined, tests: Record<string, boolean> = {}): string | undefined {
  const clis = (detect?.engines ?? []).filter((e) => e.id !== "loop").sort((a, b) => (CLI_ORDER.indexOf(a.id) + 1 || 99) - (CLI_ORDER.indexOf(b.id) + 1 || 99));
  return (clis.find((e) => tests[e.id] || e.last?.ok) ?? clis.find((e) => e.found))?.id;
}

/** The crew preset from what passed on the Engines screen. */
export function presetCrew(
  roles: { id: string; engine: string; model?: string }[],
  detect: SetupDetect | undefined,
  tests: Record<string, boolean> = {},
  defaultModel?: string,
): Record<string, CrewChoice> {
  const cli = pickCli(detect, tests);
  const hasLoop = (detect?.engines ?? []).some((e) => e.id === "loop");
  const out: Record<string, CrewChoice> = {};
  for (const r of roles) {
    if (MODEL_ROLES.has(r.id) && defaultModel && hasLoop) out[r.id] = { engine: "loop", model: defaultModel };
    else if (cli) out[r.id] = { engine: cli };
    else out[r.id] = { engine: r.engine, ...(r.model ? { model: r.model } : {}) };
  }
  return out;
}

/** "Fix the login page so it remembers me. Also..." -> "Fix the login page so it remembers me" (at most 80 chars). */
export function titleFrom(sentence: string): string {
  const first = (sentence.trim().split(/(?<=[.!?])\s+|\r?\n/)[0] ?? "").trim().replace(/[.!?]+$/, "");
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
