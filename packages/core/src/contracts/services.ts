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

// ---------- milestone 4: approval queue, runs from the server, providers, assistant, channels ----------

/** A pending decision a person answers in the console or Telegram (F5d, F14, F84 permission card). */
export interface ApprovalCardData {
  id: string;
  action: string;
  detail: string;
  /** Tool name and a short preview of its input, when it comes from an agent tool call. */
  tool?: string;
  input_preview?: string;
  actor: Actor;
  run_id?: string;
  chat_id?: string;
  /** Clipboard, screenshots and shell from low-trust sources can never be approved from Telegram (F4c, F122). */
  local_only: boolean;
  created: string;
  expires: string;
  status: "pending" | "allowed" | "denied" | "expired";
  decided_by?: string;
  decided_via?: "console" | "telegram" | "terminal" | "timeout";
  /** "chat" = allow the same tool for the rest of this chat or run. */
  scope?: "once" | "chat";
}
export interface ApprovalQueueService {
  /** Adds a card and waits for a person; resolves deny after the timeout (fail-closed, default 5 minutes). */
  request(req: Omit<ApprovalCardData, "id" | "created" | "expires" | "status">, opts?: { timeoutMs?: number }): Promise<ApprovalCardData>;
  pending(): ApprovalCardData[];
  recent(limit?: number): ApprovalCardData[];
  /** Returns the updated card; refuses local_only cards from channel "telegram". */
  answer(id: string, decision: "allow" | "deny", by: string, via: "console" | "telegram" | "terminal", scope?: "once" | "chat"): ApprovalCardData;
}

export interface RunStartOptions extends Omit<RunOptions, "cwd" | "mode"> {
  runtime?: "claude-code" | "cursor";
  mode?: RunMode;
  cwd?: string;
  /** Who started it (F98: the person's own logins are used). */
  actor: Actor;
  /** Where the start came from, e.g. "console" or "telegram:<chat id>" (so /stop can find its runs). */
  origin?: string;
}
export interface RunState {
  id: string;
  runtime: string;
  agent?: string;
  ticket?: string;
  mode: RunMode;
  origin?: string;
  status: "running" | "done" | "failed" | "cancelled";
  started: string;
  ended?: string;
  first_result_line?: string;
  failure_class?: string;
  usage?: { input_tokens: number; output_tokens: number; cost_usd: number | null };
}
/** Runs started from the server (console, Telegram); the CLI `hl run` keeps its own path. */
export interface RunManagerService {
  start(opts: RunStartOptions): Promise<RunState>;
  get(id: string): RunState | undefined;
  active(): RunState[];
  /** Buffered events from seq (0 = all) and live ones after; the iterator ends when the run ends. */
  events(id: string, fromSeq?: number): AsyncIterable<{ seq: number; ts: string; event: RunEvent }>;
  cancel(id: string, by: string): Promise<void>;
}

/** OpenAI-compatible provider layer (F11a-c, F72-F78). Config re-read on every request. */
export interface ProviderInfo {
  id: string;
  label: string;
  base_url: string;
  /** Env-var NAME holding the key (F9b); never the key. */
  key_env?: string;
  preset?: string;
  compat: Record<string, boolean>;
}
export interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  context_window?: number;
  max_tokens?: number;
  capabilities: { tool_calls: boolean; vision: boolean; streaming: boolean };
}
export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; name: string; arguments: string }[];
  tool_call_id?: string;
}
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>;
}
export type CompletionDelta =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "usage"; input_tokens: number; output_tokens: number; cache_read_tokens?: number }
  | { type: "done"; finish_reason: string };
export interface ProbeResult {
  provider: string;
  reachable: boolean;
  models: string[];
  chat: boolean;
  streaming: boolean;
  tool_calls: boolean;
  error?: { code: "auth" | "rate_limit" | "timeout" | "context_exceeded" | "server" | "bad_request" | "network"; message: string };
}
export interface ProvidersService {
  providers(): ProviderInfo[];
  models(): ModelInfo[];
  defaultModel(role?: "assistant" | "summariser" | "titles" | "refiner"): string | undefined;
  /** Streams one completion; retries per provider policy (F75); appends a usage line (F78, local). */
  complete(req: { model: string; messages: ChatTurn[]; tools?: ToolSpec[]; signal?: AbortSignal }): AsyncIterable<CompletionDelta>;
  probe(providerId: string): Promise<ProbeResult>;
}

export interface ChatSummaryData {
  id: string;
  title: string;
  model: string;
  channel: "console" | "telegram";
  created: string;
  updated: string;
}
export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  tool?: { name: string; input: unknown; status: "proposed" | "approved" | "denied" | "done" | "failed"; result?: string; approval_id?: string };
  ts: string;
  usage?: { input_tokens: number; output_tokens: number };
}
export type AssistantEvent =
  | { type: "message"; message: ChatMessageData }
  | { type: "delta"; message_id: string; text: string }
  | { type: "approval"; card: ApprovalCardData }
  | { type: "error"; code: string; message: string }
  /** e.g. the context window is near its limit (F74). */
  | { type: "notice"; code: string; message: string }
  | { type: "done"; message_id: string };
/** The assistant (F11d L3): chat + search + verbs as tools; writes need a confirmation card. History is local JSONL (F11e, B25). */
export interface AssistantService {
  list(): Promise<ChatSummaryData[]>;
  create(opts: { title?: string; model?: string; channel: "console" | "telegram" }): Promise<ChatSummaryData>;
  get(id: string): Promise<{ summary: ChatSummaryData; messages: ChatMessageData[] }>;
  setModel(id: string, model: string): Promise<ChatSummaryData>;
  /** Runs one user turn; events stream until "done". Low-trust channels get the low-trust preset (F66). */
  send(id: string, text: string, opts: { actor: Actor; channel: "console" | "telegram"; signal?: AbortSignal }): AsyncIterable<AssistantEvent>;
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
  // milestone 4
  approvalQueue: ApprovalQueueService;
  runManager: RunManagerService;
  providers: ProvidersService;
  assistant: AssistantService;
}
