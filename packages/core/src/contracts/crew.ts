// Milestone 8 contract: crew and engines (Blueprint 33, F152-F157). Shared by the runtimes, the model engine
// ("loop"), the crew plugin, the server and the UI. The core never names a role: roles come from the agent pack
// and the crew config.

/** A runtime engine id: "claude-code", "cursor", "loop" (the Helmlock model loop), later others. */
export type EngineId = string;

/** What an engine can do; the UI shows gestures only when the engine can (control-center capabilities). */
export interface EngineCapabilities {
  /** Continue an earlier session (F155). */
  resume: boolean;
  /** Take a message mid-run; otherwise a message is queued for the next turn. */
  steer: boolean;
  /** Tool calls go through the approval queue. */
  approve: boolean;
  /** The model is chosen per run (the loop: any configured provider model; CLIs: their own names). */
  models: boolean;
}

export interface EngineCheck {
  level: "info" | "warn" | "error";
  message: string;
}
/** Is the engine usable here: binary found and signed in, or a model reachable (Paperclip testEnvironment). */
export interface EngineTest {
  ok: boolean;
  checks: EngineCheck[];
}

/** How a run ended, reported by the agent with `hl run report` (F154). "none" = it ended without a report. */
export type OutcomeKind = "done" | "review" | "blocked" | "needs-input";
export interface RunOutcome {
  outcome: OutcomeKind;
  summary: string;
  /** The suggested next step in words ("verify slice 1"). */
  next?: string;
  /** The role the next step goes to, when the agent knows it. */
  next_role?: string;
}

/** One role of the crew and the engine it runs on by default (F157). Stored in the crew plugin config. */
export interface CrewRole {
  id: string;
  label: string;
  /** From the role's agent file description. */
  description?: string;
  engine: EngineId;
  model?: string;
  /** Build roles get a git worktree per ticket (F156). */
  worktree: boolean;
}

/** Input of a hand-off: a role takes a ticket (F152). Defaults: role = the next step's role, engine/model = the role's. */
export interface HandoffInput {
  ticket: string;
  role?: string;
  engine?: EngineId;
  model?: string;
  /** A note from the person, added to the brief. */
  message?: string;
  /** Start a fresh session instead of resuming (F155). */
  fresh?: boolean;
}

/** What the composer on a ticket did with a message. */
export type SayAction = "steered" | "queued" | "handed-off" | "commented";

/** One step of an assistant plan card (lc-wms ledger as data). */
export interface PlanStep {
  ticket: string;
  role: string;
  engine?: EngineId;
  task: string;
  /** An observable DONE check. */
  done_check: string;
  status: "proposed" | "approved" | "skipped" | "started" | "failed";
  run?: string;
  error?: string;
}
export interface PlanCard {
  id: string;
  title: string;
  steps: PlanStep[];
  status: "proposed" | "decided";
}
