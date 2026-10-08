// FROZEN CONTRACT (milestone 2: read-only console). JSON over HTTP under /api/v1 plus SSE (F145, F10c).
// Every response is { ok: true, data } or { ok: false, error: { rule, message, file?, fix? } } (same envelope as the CLI).
// Writes are not part of this milestone: every change still goes through `hl` verbs.
import type { ActivityLine, CommentLine, RecordKindName, Task, TicketRecord } from "./schemas.ts";
import type { GateResult, SearchHit, SkillEntry, StageDef, TicketDigest, WorkspaceFolder } from "./services.ts";

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { rule: string; message: string; file?: string; fix?: string } };

/** GET /api/v1/workspace */
export interface WorkspaceSummary {
  name: string;
  console_name: string;
  author: { id: string; name: string; initials: string } | null;
  root: string;
  delivery: string;
  folders: WorkspaceFolder[];
  /** Server build and API version for the footer. */
  version: { api: 1; helmlock: string };
}

/** One ticket as a board card or list row. */
export interface TicketCard {
  id: string;
  title: string;
  stage: string;
  size?: "S" | "M" | "L";
  priority: string;
  owner?: string;
  project?: string;
  blocked: boolean;
  blocked_by?: string;
  claimed_by?: string;
  open_questions: number;
  open_bugs: number;
  tasks: { total: number; done: number };
  updated: string;
}

/** GET /api/v1/board */
export interface Board {
  stages: (StageDef & { count: number })[];
  tickets: TicketCard[];
}

/** GET /api/v1/tickets?stage=&project=&owner=&blocked= */
export type TicketList = TicketCard[];

export type ArtifactKind = "md" | "toml" | "jsonl" | "html" | "other";

/** An entry of the ordered artifact index the server builds from a ticket folder (F148). */
export interface ArtifactRef {
  /** Stable, URL-safe id: the path inside the ticket folder with "/" replaced by "~", e.g. "decisions~D-001-sa.toml". */
  id: string;
  title: string;
  kind: ArtifactKind;
  /** Path relative to the workspace root. */
  path: string;
  group: "docs" | "decisions" | "questions" | "bugs" | "gaps" | "tasks" | "tests" | "other";
  size: number;
}

/** GET /api/v1/tickets/:id */
export interface TicketDetail {
  card: TicketCard;
  ticket: Record<string, unknown>;
  digest: TicketDigest;
  records: (TicketRecord & { kind: RecordKindName; path: string })[];
  tasks: Task[];
  comments: CommentLine[];
  artifacts: ArtifactRef[];
  /** Gate check for the next stage, so the UI can show why "Move" would be blocked. Read-only. */
  next_gate?: { to: string; gate: GateResult };
}

/** GET /api/v1/tickets/:id/artifacts/:artifactId -> raw text; the UI renders by kind (Markdown, TOML table, JSONL timeline, sandboxed HTML). */
export interface ArtifactContent {
  ref: ArtifactRef;
  text: string;
}

export interface NeedsYouItem {
  kind: "blocked" | "question" | "claim-stale" | "setup" | "run-failed";
  ticket?: string;
  id?: string;
  title: string;
  detail?: string;
}

export interface RunSummary {
  id: string;
  ticket?: string;
  runtime: string;
  agent?: string;
  mode: string;
  started: string;
  ended?: string;
  ok?: boolean;
  failure_class?: string;
  first_result_line?: string;
  usage?: { input_tokens: number; output_tokens: number; cost_usd: number | null };
}

export interface WorkLogLine {
  date: string;
  author: string;
  ticket: string;
  category: string;
  text: string;
  hours_alloc: number;
}

/** GET /api/v1/overview?date=YYYY-MM-DD (date defaults to today; tests pin it) */
export interface Overview {
  needs_you: NeedsYouItem[];
  stages: (StageDef & { count: number })[];
  in_progress: number;
  done_this_week: number;
  today: { date: string; worklog: WorkLogLine[]; activity: ActivityLine[] };
  runs: RunSummary[];
}

/** GET /api/v1/activity?date=YYYY-MM-DD&author= */
export type ActivityFeed = ActivityLine[];
/** GET /api/v1/worklog?from=&to=&author= */
export type WorkLogRange = WorkLogLine[];
/** GET /api/v1/runs */
export type RunList = RunSummary[];
/** GET /api/v1/skills */
export type SkillList = SkillEntry[];
/** GET /api/v1/search?q= */
export type SearchResults = SearchHit[];

/**
 * GET /api/v1/events (text/event-stream). First event "snapshot" with the current version, then "change" events
 * batched at most once per 250 ms (F109). The UI invalidates its queries by `areas`.
 */
export interface SnapshotEvent {
  version: number;
}
export interface ChangeEvent {
  version: number;
  areas: ("tickets" | "records" | "tasks" | "worklog" | "activity" | "runs" | "workspace" | "skills" | "todos" | "approvals" | "chats")[];
  tickets: string[];
  paths: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Milestone 3: the writable console. Writes go through the SAME verb registry as the CLI (F13a): activity lines,
// gates, guards, page refresh and stale-write checks all apply. No second write path.
// ---------------------------------------------------------------------------------------------------------------

/** Verbs the console may call. Anything else is refused with 403 rule "verb-not-allowed". Agent runs, init, serve and
 *  harness generation stay CLI-only in this milestone. */
export const CONSOLE_VERBS = [
  "ticket new",
  "ticket set",
  "ticket move",
  "ticket block",
  "ticket unblock",
  "ticket claim",
  "ticket release",
  "ticket comment",
  "decision add",
  "question add",
  "question answer",
  "bug add",
  "bug resolve",
  "gap add",
  "gap resolve",
  "task add",
  "task set",
  "todo add",
  "todo done",
  "log-work",
  "validate",
  "config set",
  "provider add",
  "ticket close",
  "ticket archive",
  "ticket restore",
  "notes build",
  "index build",
  "todo move",
  "chat share",
  "run attach",
  "people add",
  "people claim",
  // Milestone 7: machine secrets (value written to the gitignored .env, never echoed or logged) and several models.
  "secret set",
  // Read-only: where each secret name is found (environment, .env, missing). Never values.
  "secret status",
  "model add",
  "model remove",
  "model default",
  "provider remove",
  // Milestone 7: project switcher. Both write the .code-workspace file: the console shows the dry run, then confirms with yes.
  "project add",
  "project import",
  // Milestone 8: crew roles (engine and model per role).
  "crew set",
] as const;
export type ConsoleVerb = (typeof CONSOLE_VERBS)[number];

/** Header every write must carry (with Content-Type: application/json); a cross-site form cannot set it. */
export const WRITE_HEADER = "X-Helmlock-Request";

export interface VerbField {
  key: string;
  kind: "boolean" | "string" | "number" | "array" | "unknown";
  of?: "boolean" | "string" | "number" | "unknown";
  required: boolean;
  choices?: string[];
  description?: string;
}

/** GET /api/v1/verbs: the console verbs with their inputs, so forms can be generated (F9c). */
export interface VerbInfo {
  id: ConsoleVerb;
  summary: string;
  examples: string[];
  writes: boolean;
  /** Positional argument names in CLI order (also input keys). */
  args: string[];
  fields: VerbField[];
}
export type VerbCatalog = VerbInfo[];

/** POST /api/v1/verbs/<noun>/<verb> (e.g. /verbs/ticket/move, /verbs/log-work), JSON body. */
export interface VerbCall {
  input: Record<string, unknown>;
  dry_run?: boolean;
}
/** Response body; HTTP 200 for ok, 409 for a code-2 block (gate or guard), 400/422 for code 1. */
export type VerbCallResult =
  | { ok: true; data: unknown; text?: string }
  | { ok: false; code: 1 | 2; error: { rule: string; message: string; file?: string; fix?: string }; data?: unknown };

/** GET /api/v1/todos?status=open|done&ticket= */
export interface TodoItem {
  id: string;
  text: string;
  status: "open" | "done";
  priority: string;
  due?: string;
  ticket?: string;
  created: string;
  author: string;
  scope: "team" | "personal" | "private";
}
export type TodoList = TodoItem[];

/** A setting a plugin declares in plugin.toml [settings.<key>] (F44). Secrets are stored by env-var name only (F9b). */
export interface SettingField {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "secret-env" | "list";
  label: string;
  hint?: string;
  default?: string | number | boolean;
  options?: string[];
  /** "workspace" = workspace.toml (shared, committed); "local" = workspace.local.toml (this machine). */
  scope: "workspace" | "local";
}
export interface PluginSettings {
  plugin: string;
  label: string;
  fields: SettingField[];
  /** Current composed values and the layer each came from. */
  values: Record<string, { value: unknown; source: "default" | "bundle" | "workspace.toml" | "workspace.local.toml" | "flags" }>;
}
/** GET /api/v1/settings: F9a sections; a section may be empty (shown with what is coming). */
export interface SettingsView {
  sections: { id: "workspace" | "models" | "agents" | "permissions" | "telegram"; label: string; plugins: PluginSettings[] }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Milestone 4: agent runs from the console, approvals, the assistant and models. All writes below need the same
// protection as verb calls (JSON, WRITE_HEADER, same origin, Host check).
// ---------------------------------------------------------------------------------------------------------------
import type {
  ApprovalCardData,
  AssistantEvent,
  ChatMessageData,
  ChatSummaryData,
  ModelInfo,
  ProbeResult,
  ProviderInfo,
  RunEvent,
  RunMode,
  RunState,
} from "./services.ts";

/** POST /api/v1/runs. Modes allowed from the console: plan, ask, auto-review ("force" stays in the terminal). */
export interface RunStart {
  task: string;
  runtime?: string;
  agent?: string;
  ticket?: string;
  mode?: Exclude<RunMode, "force">;
  model?: string;
  /** Milestone 7: run in this project's repo folder (its first repo folder of the workspace file that exists). */
  project?: string;
}
/** GET /api/v1/runs/:id and the 201 body of POST /runs. */
export type RunDetail = RunState;
/** GET /api/v1/runs/:id/events (SSE): "event" frames with RunEventLine (replayed from ?from=seq, default 0), then "end". */
export interface RunEventLine {
  seq: number;
  ts: string;
  event: RunEvent;
}
/** POST /api/v1/runs/:id/cancel -> RunDetail. */

/** GET /api/v1/approvals?status=pending|recent */
export type ApprovalCard = ApprovalCardData;
/** POST /api/v1/approvals/:id */
export interface ApprovalAnswer {
  decision: "allow" | "deny";
  scope?: "once" | "chat";
}
/** Internal: POST /api/v1/hooks/pretooluse from the hook script of a server-started run. Authenticated by the header
 *  X-Helmlock-Hook-Token (a per-server secret passed to child runs as HL_HOOK_TOKEN); waits for the person; returns
 *  the Claude Code PreToolUse decision. Not callable from the browser. */
export interface HookDecision {
  decision: "allow" | "deny";
  reason: string;
}

/** GET /api/v1/models */
export interface ModelsView {
  providers: ProviderInfo[];
  models: ModelInfo[];
  default?: string;
}
/** POST /api/v1/models/test { provider } */
export type ModelProbe = ProbeResult;
/** POST /api/v1/models/try { base_url, key_env?, key?, preset?, model?, list_only? } -> ModelProbe. Try a provider before
 *  saving it: same write protection as other writes, but it only reads the remote server and writes nothing locally.
 *  base_url may be given with or without a trailing /v1, /v1/models or /api/v1/models. */
export interface ModelTry {
  base_url: string;
  key_env?: string;
  /** A pasted key, used for this request only (milestone 7): never persisted, logged or returned. Wins over key_env. */
  key?: string;
  preset?: string;
  model?: string;
  list_only?: boolean;
}

/** GET /api/v1/chats ; POST /api/v1/chats { title?, model? } -> ChatSummary */
export type ChatSummary = ChatSummaryData;
/** GET /api/v1/chats/:id */
export interface ChatDetail {
  summary: ChatSummaryData;
  messages: ChatMessageData[];
}
/** POST /api/v1/chats/:id/messages { text } -> 202; the turn streams over GET /api/v1/chats/:id/events (SSE "assistant"
 *  frames with AssistantEvent). POST /api/v1/chats/:id/model { model } -> ChatSummary. */
export type ChatEvent = AssistantEvent;

// ---------------------------------------------------------------------------------------------------------------
// Milestone 5: v1 completion (knowledge, inbox state, lifecycle, first-run setup).
// ---------------------------------------------------------------------------------------------------------------

/** GET /api/v1/knowledge: the shared area and projects (F115, F143), for the Knowledge page. */
export interface KnowledgeView {
  /** Lines of the generated shared/INDEX.md: one per document (F116). */
  index: {
    path: string;
    title: string;
    summary: string;
    kind: "wiki" | "decision" | "runbook" | "standard" | "glossary" | "template" | "checklist" | "digest" | "other";
  }[];
  projects: { id: string; name: string; status: string; owners: string[]; repos: string[]; goals: string[]; tickets: number }[];
  /** Closure digests of closed tickets, newest first (F125). */
  digests: { ticket: string; title: string; closed: string; path: string }[];
}
/** GET /api/v1/knowledge/doc?path=shared/... -> raw markdown (inside shared/ or projects/ only). */
export interface KnowledgeDoc {
  path: string;
  text: string;
}

/** Inbox read/archive state per person, stored locally (F67): items resurface on new activity. */
export interface InboxItemState {
  key: string;
  read_at?: string;
  archived_at?: string;
}
/** GET /api/v1/inbox -> items derived from files plus local state; POST /api/v1/inbox/:key { read?: boolean, archived?: boolean }. */
export interface InboxItem {
  key: string;
  kind: "approval" | "question" | "blocked" | "run-failed" | "claim-stale" | "setup" | "retention";
  title: string;
  detail?: string;
  ticket?: string;
  id?: string;
  updated: string;
  read: boolean;
  archived: boolean;
}

/** GET /api/v1/setup: first-run checklist for the web wizard (F1a after the writable console). */
export interface SetupStatus {
  /** Blueprint 34: you, engine, code (optional), crew, phone (optional), first-task. Same list as `hl setup`. */
  steps: {
    id: SetupStepId;
    label: string;
    done: boolean;
    detail: string;
    action?: string;
    /** Optional steps (code, phone) may be skipped and do not count as "left". */
    optional?: boolean;
  }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Milestone 6: people and storage scopes (Blueprint 31). Shared = committed; personal = committed under
// people/<slug>/ (visible to the team); private/local = .hl-local/ and other gitignored paths, this machine only.
// ---------------------------------------------------------------------------------------------------------------

/** GET /api/v1/people */
export interface PeopleView {
  me: { id: string; name: string; initials: string; email?: string } | null;
  people: { id: string; name: string; initials: string; role?: string; email?: string; git: string[] }[];
  /** git author names or emails in this repo's history that no person claims (lc-wms `people --unknown`). */
  unknown_git: { name: string; email: string; commits: number }[];
}

/** One agent or skill after layer resolution: which layer won, and which ones it hides. */
export interface ResolvedItem {
  kind: "agent" | "skill";
  name: string;
  layer: "system" | "workspace" | "project" | "personal" | "local";
  path: string;
  overrides: { layer: string; path: string }[];
}
/** GET /api/v1/overrides */
export type OverridesView = ResolvedItem[];

// ---------------------------------------------------------------------------------------------------------------
// Milestone 7: project switcher. One console serves one knowledge center (F138); other centers are listed, not switched.
// ---------------------------------------------------------------------------------------------------------------

/** One project of projects/<id>/project.toml with its repo folders resolved through the live .code-workspace file. */
export interface ProjectEntry {
  id: string;
  name: string;
  status: string;
  /** Repo folder names from project.toml; path is absolute when the workspace file names the folder. */
  repos: { folder: string; path?: string; exists: boolean }[];
  tickets: number;
}
/** GET /api/v1/projects */
export interface ProjectsView {
  projects: ProjectEntry[];
}

/** A knowledge center this machine has served (~/.helmlock/recent.toml, written by `hl serve`). */
export interface CenterEntry {
  name: string;
  root: string;
  port: number;
  last_opened: string;
  /** A console answered GET /api/v1/workspace at that port for that root just now. */
  running: boolean;
  url?: string;
  /** What to run in `root` when it is not running. */
  command: string;
}
/** GET /api/v1/centers */
export interface CentersView {
  current: { name: string; console_name: string; root: string };
  others: CenterEntry[];
}

// ---------- milestone 8: crew and engines (Blueprint 33, F152-F157) ----------
import type { CrewRole, EngineCapabilities, EngineId, EngineTest, HandoffInput, OutcomeKind, PlanCard, RunOutcome, SayAction } from "./crew.ts";

export type { CrewRole, EngineCapabilities, EngineId, EngineTest, HandoffInput, OutcomeKind, PlanCard, RunOutcome, SayAction };

export interface EngineView {
  id: EngineId;
  label: string;
  capabilities: EngineCapabilities;
  test: EngineTest;
}
/** GET /api/v1/crew: the roles with what each is doing now. */
export interface CrewView {
  roles: (CrewRole & {
    engine_ok: boolean;
    engine_problem?: string;
    /** Running or queued runs of this role. */
    current: RunState[];
    last?: RunState;
  })[];
  engines: EngineView[];
  live: number;
  max_live: number;
  /** Approvals pending, runs ended needs-input or review, open questions: across all runs. */
  needs_you: NeedsYouItem[];
}
/** GET /api/v1/tickets/:id/next -> NextStep | null */
export interface NextStep {
  role: string;
  label: string;
  engine: EngineId;
  model?: string;
  reason: string;
}
/** GET /api/v1/tickets/:id/thread: comments and runs in one timeline, oldest first. */
export type ThreadItem = { kind: "comment"; ts: string; author: string; text: string; run?: string } | { kind: "run"; ts: string; run: RunState };
export interface TicketThread {
  ticket: string;
  items: ThreadItem[];
  next: NextStep | null;
  /** The run currently live or queued on this ticket, if any. */
  live?: RunState;
}
/** POST /api/v1/tickets/:id/handoff (HandoffInput without ticket) -> RunDetail (201). */
export type HandoffBody = Omit<HandoffInput, "ticket">;
/** POST /api/v1/tickets/:id/say {text} -> SayResult. */
export interface SayResult {
  action: SayAction;
  run?: RunState;
}
/** POST /api/v1/runs/:id/say {text} -> {delivered}. */
export interface RunSayResult {
  delivered: "live" | "queued";
}
/** GET /api/v1/runs/:id/diff */
export interface RunDiff {
  files: { file: string; added: number; removed: number }[];
  patch: string;
}
/** POST /api/v1/runs/:id/merge -> RunMergeResult; POST /api/v1/runs/:id/reset-session -> 204. */
export interface RunMergeResult {
  merged: boolean;
  message: string;
}
/** POST /api/v1/chats/:id/plans/:plan {decisions: {[step index]: "approve" | "skip"}, revise?: string} -> PlanCard.
 *  Approved steps become hand-offs; "revise" sends the text back to the assistant as the next user turn. */
export interface PlanDecision {
  decisions: Record<string, "approve" | "skip">;
  revise?: string;
}
export type PlanDecisionResult = PlanCard;
/** GET /api/v1/runs?ticket=&role=&limit= -> RunState[] (milestone 8 filters). */
export type RunStateList = RunState[];
/** Re-exported so the outcome type is reachable from the API module. */
export type RunOutcomeView = RunOutcome;
export type OutcomeKindView = OutcomeKind;

// ---------------------------------------------------------------------------------------------------------------
// Onboarding v2 (Blueprint 34): the /welcome wizard. Detection never sends values: key names and sources only, a
// redacted first line of a hello probe at most. Git identity is a suggestion and is used only after a confirm.
// ---------------------------------------------------------------------------------------------------------------

export type SetupStepId = "you" | "engine" | "code" | "crew" | "phone" | "first-task";

/** One ordered check of an engine test (Paperclip testEnvironment): code is stable, message and hint are for people. */
export interface SetupCheck {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
  hint?: string;
}
/** POST /api/v1/setup/test-engine {engine, model?} -> SetupEngineTest. ok = no error-level check. */
export interface SetupEngineTestBody {
  engine: EngineId;
  model?: string;
}
export interface SetupEngineTest {
  engine: EngineId;
  ok: boolean;
  checks: SetupCheck[];
  /** When it ran (ISO). */
  at: string;
}

/** A model provider that can be added in one click: a preset whose key name is set, or a local server that answers. */
export interface SetupProviderCandidate {
  preset: string;
  label: string;
  base_url: string;
  key_env?: string;
  /** Where the key was found, or "running" for a local server that answered. */
  source: "environment" | ".env" | "running";
  /** Models a running local server listed. */
  models?: string[];
}

/** GET /api/v1/setup/detect */
export interface SetupDetect {
  you: {
    /** From the knowledge repo's git config: a suggestion only, never the identity without a confirm. */
    git_name?: string;
    git_email?: string;
    suggested_slug?: string;
    suggested_initials?: string;
    /** author.local, when set. */
    author?: string;
    /** author.local names a roster person: the You screen is skipped. */
    author_known: boolean;
    person?: { id: string; name: string };
    /** A roster person who already claims the git name or email ("Is this you?"). */
    match?: { id: string; name: string };
  };
  engines: {
    id: EngineId;
    label: string;
    capabilities: EngineCapabilities;
    /** CLI found on this machine (always true for engines without a binary, such as the loop). */
    found: boolean;
    version?: string;
    /** The cached test (detect-based; a hello test runs only on demand). */
    test: EngineTest;
    /** The last on-demand test in this console session. */
    last?: SetupEngineTest;
  }[];
  providers: {
    configured: { id: string; label: string; models: number }[];
    default_model?: string;
    candidates: SetupProviderCandidate[];
  };
  /** Folders of the workspace file that no project names yet. */
  folders: { name: string; path: string }[];
  projects: { id: string; name: string }[];
}

/** POST /api/v1/setup/you: add (or pick) the roster person, write author.local, claim the git name. Only when no valid author is set. */
export interface SetupYouBody {
  id: string;
  name?: string;
  initials?: string;
  email?: string;
  /** Git spellings to claim for this person (the confirmed git name and email). */
  git?: string[];
}
export interface SetupYouResult {
  person: { id: string; name: string; initials: string };
  created: boolean;
  claimed: string[];
}

/** POST /api/v1/setup/upkeep: technical upkeep the wizard repairs silently (harness sync, per-machine gitignore). */
export interface SetupUpkeep {
  repaired: string[];
  /** Only failures are shown to the person. */
  failures: { name: string; message: string; fix?: string }[];
}
