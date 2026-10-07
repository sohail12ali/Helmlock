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
}
export type TodoList = TodoItem[];

/** A setting a plugin declares in plugin.toml [settings.<key>] (F44). Secrets are stored by env-var name only (F9b). */
export interface SettingField {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "secret-env";
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
  runtime?: "claude-code" | "cursor";
  agent?: string;
  ticket?: string;
  mode?: Exclude<RunMode, "force">;
  model?: string;
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
