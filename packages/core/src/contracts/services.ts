// FROZEN CONTRACT (milestone 1). Every service key and its interface, declared up front.
import type { FileLayer } from "./files.ts";
import type { Disposer } from "./kernel.ts";
import type {
  ActivityLine,
  CommentLine,
  LayerName,
  Person,
  PluginRow,
  RecordKindName,
  Task,
  TicketRecord,
  TicketToml,
  TodoRecord,
  WorkLogDay,
  WorkLogEntry,
  WorkspaceToml,
} from "./schemas.ts";
import type { Actor, VerbsService } from "./verbs.ts";

// ---------- workspace and config (core) ----------
export interface WorkspaceFolder {
  name: string;
  /** Absolute path. */
  path: string;
  layer: LayerName | "product";
}
export interface WorkspaceInfo {
  /** Knowledge repo root (the folder holding the .code-workspace). */
  root: string;
  /** Delivery repo root (the folder named "system" in the workspace file, or HL_DELIVERY / .env). */
  deliveryRoot: string;
  codeWorkspaceFile: string | undefined;
  folders: WorkspaceFolder[];
  name: string;
  /** Author slug from author.local; undefined if not set (verbs that need it fail with unknown-author). */
  author: string | undefined;
  /** Where each value came from, for `hl where` (F39). */
  sources: Record<string, string>;
}

export interface ConfigSource {
  layer: "bundle" | "workspace.toml" | "workspace.local.toml" | "flags";
  file?: string;
}
export interface ConfigService {
  readonly workspace: WorkspaceToml;
  /** Composed plugin rows after bundles, workspace.toml, workspace.local.toml and flags. */
  rows(): (PluginRow & { source: ConfigSource })[];
  pluginConfig(id: string): Record<string, unknown>;
}

export interface ApprovalRequest {
  action: string; // "git push", "shell", "schema-change"
  detail: string;
  actor: Actor;
}
export interface ApprovalsService {
  /** ACT/ASK, fail-closed: no answer means deny (F5d, F14). */
  decide(req: ApprovalRequest): Promise<{ decision: "allow" | "deny"; reason: string }>;
}

// ---------- people ----------
export interface RosterService {
  list(): Promise<Person[]>;
  get(slug: string): Promise<Person | undefined>;
  /** The author on this machine; throws a VerbError-shaped error (rule "unknown-author") if not in the roster. Never guessed. */
  current(): Promise<Person>;
}

// ---------- tickets ----------
export interface Ticket extends TicketToml {
  /** Folder relative to the workspace root, e.g. "artifacts/T-014-sa". */
  dir: string;
}
export interface TicketFilter {
  stage?: string;
  owner?: string;
  project?: string;
  blocked?: boolean;
}
export interface CreateTicketInput {
  title: string;
  summary?: string;
  size?: "S" | "M" | "L";
  priority?: "low" | "normal" | "high" | "urgent";
  project?: string;
  goal?: string;
}
export interface TicketsService {
  /** Next id for this author: counter over existing ids with the same initials, e.g. T-015-sa. */
  nextId(prefix: "T" | "D" | "Q" | "B" | "G" | "TD", initials: string, ticket?: string): Promise<string>;
  create(input: CreateTicketInput, actor: Actor, opts?: { dryRun?: boolean }): Promise<Ticket>;
  get(id: string): Promise<Ticket>;
  list(filter?: TicketFilter): Promise<Ticket[]>;
  /** Asks the workflow (gates) first; returns the gate result when blocked. */
  move(id: string, to: string, actor: Actor, opts?: { dryRun?: boolean }): Promise<{ ticket: Ticket; gate: GateResult }>;
  setBlocked(id: string, blocked: { by: string; next: string } | null, actor: Actor, opts?: { dryRun?: boolean }): Promise<Ticket>;
  /** Atomic local claim; a second claimer gets ClaimConflict (never retried). */
  claim(id: string, actor: Actor, opts?: { dryRun?: boolean }): Promise<Ticket>;
  release(id: string, actor: Actor, opts?: { dryRun?: boolean }): Promise<Ticket>;
  comment(id: string, text: string, actor: Actor, opts?: { dryRun?: boolean }): Promise<CommentLine>;
  comments(id: string): Promise<CommentLine[]>;
}

export interface RecordsService {
  add(kind: RecordKindName, ticket: string, data: Record<string, unknown>, actor: Actor, opts?: { dryRun?: boolean }): Promise<TicketRecord>;
  list(ticket: string, kind?: RecordKindName): Promise<(TicketRecord & { kind: RecordKindName; path: string })[]>;
  get(id: string): Promise<TicketRecord & { kind: RecordKindName; path: string }>;
  update(id: string, patch: Record<string, unknown>, actor: Actor, opts?: { dryRun?: boolean }): Promise<TicketRecord>;
  /** Open blocking questions, open bugs and gaps that stop a stage move. */
  blockers(ticket: string): Promise<(TicketRecord & { kind: RecordKindName })[]>;
}

export interface TasksService {
  list(ticket: string): Promise<Task[]>;
  add(
    ticket: string,
    task: Omit<Task, "id" | "status" | "depends" | "files" | "acs"> & Partial<Task>,
    actor: Actor,
    opts?: { dryRun?: boolean },
  ): Promise<Task>;
  set(ticket: string, taskId: string, patch: Partial<Task>, actor: Actor, opts?: { dryRun?: boolean }): Promise<Task>;
}

export interface StageDef {
  id: string;
  label: string;
  agent?: string;
  wip?: number;
  terminal?: boolean;
}
export interface GateResult {
  allowed: boolean;
  /** Each reason names the rule and the fix. */
  reasons: { rule: string; message: string; fix?: string }[];
}
export interface WorkflowService {
  stages(): StageDef[];
  /** Transition and gate check for a move; never writes. */
  check(ticket: Ticket, to: string): Promise<GateResult>;
}

export interface Finding {
  level: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  fix?: string;
}
export interface ValidateService {
  ticket(id: string): Promise<Finding[]>;
  /** For the PostToolUse hook: only the checks that apply to this one file. Budget < 300 ms. */
  file(path: string): Promise<Finding[]>;
  all(): Promise<Finding[]>;
}

// ---------- knowledge ----------
export interface TodosService {
  add(
    input: { text: string; ticket?: string; due?: string; priority?: TodoRecord["priority"] },
    actor: Actor,
    opts?: { dryRun?: boolean },
  ): Promise<TodoRecord>;
  done(id: string, actor: Actor, opts?: { dryRun?: boolean }): Promise<TodoRecord>;
  list(filter?: { status?: "open" | "done"; ticket?: string }): Promise<TodoRecord[]>;
}

export interface WorkLogService {
  /** Validates the sentence, dedupes (~70% similar on the same day and ticket), writes logs/YYYY-MM/YYYY-MM-DD.<author>.toml. */
  append(
    input: Omit<WorkLogEntry, "logged"> & { date?: string },
    author: Person,
    opts?: { dryRun?: boolean },
  ): Promise<{ written: boolean; reason?: string; file: string; entry: WorkLogEntry }>;
  day(date: string, author: string): Promise<WorkLogDay | undefined>;
  /** Entries with hours allocated (quarter hours, pinned hours kept). */
  range(from: string, to: string, author?: string): Promise<(WorkLogEntry & { date: string; author: string; hours_alloc: number })[]>;
}

export interface ActivityService {
  /** activity/YYYY-MM/DD.<author>.jsonl, one per person per day, committed (F70, B24). */
  append(line: Omit<ActivityLine, "ts"> & { ts?: string }): Promise<void>;
  read(date: string, author?: string): Promise<ActivityLine[]>;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}
export interface SearchService {
  query(q: string, opts?: { archived?: boolean; limit?: number }): Promise<SearchHit[]>;
}

export interface TicketDigest {
  ticket: { id: string; title: string; stage: string; size?: string; priority: string; owner?: string; project?: string; goal?: string };
  blocked: { blocked: boolean; by?: string; next?: string };
  claim?: { by: string; at: string };
  open_questions: { id: string; text: string; blocking: boolean }[];
  open_bugs: { id: string; title: string }[];
  tasks: { total: number; done: number; next?: string };
  next: string[];
  files: string[];
}
export interface SessionDigest {
  in_flight: { id: string; title: string; stage: string; blocked: boolean }[];
  skills: Record<LayerName, string[]>;
  waiting: string[];
}
export interface ContextService {
  ticket(id: string): Promise<TicketDigest>;
  /** Capped (about 12 rows, 1,200 characters) for the SessionStart hook (F126). */
  session(): Promise<SessionDigest>;
}

export interface SkillEntry {
  name: string;
  description: string;
  layer: LayerName;
  folder: string;
  path: string;
}
export interface SkillsService {
  list(): Promise<SkillEntry[]>;
  /** Ranked; same-named skills in several layers are all returned (F89). */
  find(query: string): Promise<(SkillEntry & { score: number })[]>;
}

// ---------- harness and runtimes ----------
export interface HarnessFileResult {
  path: string;
  status: "written" | "unchanged" | "stale" | "missing";
}
export interface HarnessService {
  /** Generate host config from harness/harness.toml; with check, write nothing and report stale files. */
  sync(opts?: { check?: boolean; root?: string }): Promise<HarnessFileResult[]>;
  lint(opts?: { root?: string }): Promise<Finding[]>;
}

export type RunMode = "plan" | "ask" | "auto-review" | "force";
export interface RunOptions {
  prompt: string;
  cwd: string;
  addDirs?: string[];
  agent?: string;
  model?: string;
  mode: RunMode;
  ticket?: string;
  resumeSessionId?: string;
  timeoutSec?: number;
  /** Seconds of silence before the run is flagged / killed (F65). */
  silenceSec?: number;
  env?: Record<string, string>;
}
export type RunEvent =
  | { type: "init"; sessionId?: string; model?: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; phase: "start" | "end"; name: string; id?: string; input?: unknown; isError?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number }
  | { type: "result"; ok: boolean; text: string; sessionId?: string; failureClass?: string }
  | { type: "stderr"; text: string }
  | { type: "raw"; line: string };
export interface RunHandle {
  readonly id: string;
  readonly events: AsyncIterable<RunEvent>;
  /** Tree kill (taskkill /T then /T /F on Windows). */
  cancel(): Promise<void>;
  done: Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }>;
}
export interface BinaryInfo {
  command: string;
  version?: string;
}
export interface RuntimeAdapter {
  id: "claude-code" | "cursor";
  detect(): Promise<BinaryInfo | null>;
  start(opts: RunOptions): Promise<RunHandle>;
}
export interface RuntimesService {
  register(adapter: RuntimeAdapter): Disposer;
  get(id: string): RuntimeAdapter | undefined;
  list(): RuntimeAdapter[];
}

export interface InitOptions {
  dir: string;
  name: string;
  author: { name: string; slug: string; initials: string; email?: string };
  deliveryRoot: string;
  dryRun?: boolean;
  git?: boolean;
}
export interface ScaffoldService {
  init(opts: InitOptions): Promise<{ created: string[] }>;
  addProject(opts: { folder: string; path: string; id?: string; dryRun?: boolean }): Promise<{ changed: string[] }>;
}

// ---------- the registry of service keys ----------
export interface Services {
  files: FileLayer;
  verbs: VerbsService;
  approvals: ApprovalsService;
  config: ConfigService;
  workspace: WorkspaceInfo;
  roster: RosterService;
  tickets: TicketsService;
  records: RecordsService;
  tasks: TasksService;
  workflow: WorkflowService;
  validate: ValidateService;
  todos: TodosService;
  worklog: WorkLogService;
  activity: ActivityService;
  search: SearchService;
  context: ContextService;
  skills: SkillsService;
  harness: HarnessService;
  runtimes: RuntimesService;
  scaffold: ScaffoldService;
}
