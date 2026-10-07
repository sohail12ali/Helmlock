// FROZEN CONTRACT (milestone 2: read-only console). JSON over HTTP under /api/v1 plus SSE (F145, F10c).
// Every response is { ok: true, data } or { ok: false, error: { rule, message, file?, fix? } } (same envelope as the CLI).
// Writes are not part of this milestone: every change still goes through `hl` verbs.
import type { ActivityLine, CommentLine, Task, TicketRecord, RecordKindName } from "./schemas.ts";
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

/** GET /api/v1/overview */
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
  areas: ("tickets" | "records" | "tasks" | "worklog" | "activity" | "runs" | "workspace" | "skills")[];
  tickets: string[];
  paths: string[];
}
