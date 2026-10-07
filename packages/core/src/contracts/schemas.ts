// FROZEN CONTRACT (milestone 1). Shared Zod schemas; the single source for types.
// Objects are .loose(): unknown keys survive a read so the file layer can keep them on rewrite (F25).
import { z } from "zod";

export const SchemaVersion = z.number().int().positive();
export const AuthorSlug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const Initials = z.string().regex(/^[a-z]{2,3}$/);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoTime = z.string(); // ISO 8601 timestamp

export const TicketId = z.string().regex(/^T-\d{3,}-[a-z]{2,3}$/);
export const RecordId = z.string().regex(/^[DQBG]-\d{3,}-[a-z]{2,3}$/);
export const TodoId = z.string().regex(/^TD-\d{3,}-[a-z]{2,3}$/);
export const TaskId = z.string().regex(/^S\d+-T\d+$/);
export type TicketId = z.infer<typeof TicketId>;

export const Size = z.enum(["S", "M", "L"]);
export const Priority = z.enum(["low", "normal", "high", "urgent"]);
export const Layer = z.enum(["db", "api", "ui", "test", "env", "spike", "docs"]);
export const Category = z.enum(["Development", "Code Review", "Testing", "Design", "Documentation", "Internal"]);

// ---------- people ----------
export const Person = z
  .object({
    id: AuthorSlug,
    name: z.string().min(1),
    initials: Initials,
    email: z.string().optional(),
    role: z.string().optional(),
    /** Every git author name or email seen for this person (attribution only; never used to guess who is at the keyboard). */
    git: z.array(z.string()).default([]),
  })
  .loose();
export type Person = z.infer<typeof Person>;

/**
 * Where a thing is stored (Blueprint 31):
 * - "team": shared, committed at the usual place (e.g. todos/)
 * - "personal": committed under people/<slug>/, visible to the team
 * - "private": this machine only, under .hl-local/ (gitignored)
 */
export const Scope = z.enum(["team", "personal", "private"]);
export type Scope = z.infer<typeof Scope>;
export const PeopleToml = z.object({ schema_version: SchemaVersion, person: z.array(Person).default([]) }).loose();
export type PeopleToml = z.infer<typeof PeopleToml>;

// ---------- workspace ----------
export const PluginRow = z
  .object({
    id: z.string().min(1),
    use: z.string().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
    disabled: z.boolean().optional(),
  })
  .loose();
export type PluginRow = z.infer<typeof PluginRow>;

/** Agent and skill layers; personal (people/<slug>/) and local (.hl-local/) override the shared ones (Blueprint 31). */
export const LayerName = z.enum(["system", "workspace", "project", "personal", "local"]);
export type LayerName = z.infer<typeof LayerName>;

export const WorkspaceToml = z
  .object({
    schema_version: SchemaVersion,
    workspace: z
      .object({
        name: z.string().min(1),
        console_name: z.string().optional(),
        plugin_dirs: z.array(z.string()).default([]),
      })
      .loose(),
    bundles: z.array(z.string()).default(["delivery-lite"]),
    plugin: z.array(PluginRow).default([]),
    /** Folder name (from the .code-workspace) to layer. Paths never live here (B24). */
    layers: z.array(z.object({ folder: z.string(), layer: LayerName }).loose()).default([]),
    retention: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type WorkspaceToml = z.infer<typeof WorkspaceToml>;

export const ProjectToml = z
  .object({
    schema_version: SchemaVersion,
    project: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        status: z.string().default("active"),
        owners: z.array(AuthorSlug).default([]),
        /** Folder names from the .code-workspace, never paths. */
        repos: z.array(z.string()).default([]),
        goals: z.array(z.string()).default([]),
      })
      .loose(),
  })
  .loose();
export type ProjectToml = z.infer<typeof ProjectToml>;

export const CodeWorkspace = z
  .object({
    folders: z.array(z.object({ name: z.string().optional(), path: z.string() }).loose()),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type CodeWorkspace = z.infer<typeof CodeWorkspace>;

export const PluginManifest = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["code", "pack"]),
    version: z.string(),
    requires_core: z.string().default(">=1 <2"),
    provides: z.array(z.string()).default([]),
    requires: z.array(z.string()).default([]),
    /** Verb ids this plugin registers ("ticket move"); lets the CLI mount lazily per verb. */
    verbs: z.array(z.string()).default([]),
    fills: z.array(z.string()).default([]),
    entry: z.string().default("index.ts"),
    required: z.boolean().default(false),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type PluginManifest = z.infer<typeof PluginManifest>;

// ---------- tickets ----------
export const TicketToml = z
  .object({
    schema_version: SchemaVersion,
    ticket: z
      .object({
        id: TicketId,
        title: z.string().min(1),
        summary: z.string().optional(),
        stage: z.string(),
        size: Size.optional(),
        priority: Priority.default("normal"),
        owner: z.string().optional(),
        project: z.string().optional(),
        goal: z.string().optional(),
        created: IsoTime,
        updated: IsoTime,
      })
      .loose(),
    flags: z
      .object({
        blocked: z.boolean().default(false),
        blocked_by: z.string().optional(),
        next_action: z.string().optional(),
      })
      .loose()
      .default({ blocked: false }),
    claim: z.object({ claimed_by: AuthorSlug, claimed_at: IsoTime }).loose().optional(),
    links: z
      .object({ parent: z.string().optional(), related: z.array(z.string()).default([]) })
      .loose()
      .default({ related: [] }),
    changes: z.array(z.object({ repo: z.string(), branch: z.string().optional() }).loose()).default([]),
  })
  .loose();
export type TicketToml = z.infer<typeof TicketToml>;

export const RecordStatus = z.enum(["open", "answered", "accepted", "rejected", "fixed", "closed", "withdrawn"]);

export const DecisionRecord = z
  .object({
    schema_version: SchemaVersion,
    id: RecordId,
    ticket: TicketId,
    title: z.string(),
    chosen: z.string().optional(),
    why: z.string().optional(),
    rejected: z.array(z.string()).default([]),
    status: RecordStatus.default("accepted"),
    date: IsoTime,
    author: AuthorSlug,
  })
  .loose();
export const QuestionRecord = z
  .object({
    schema_version: SchemaVersion,
    id: RecordId,
    ticket: TicketId,
    text: z.string(),
    blocking: z.boolean().default(false),
    options: z.array(z.string()).default([]),
    status: RecordStatus.default("open"),
    answer: z.string().optional(),
    asked: IsoTime,
    answered: IsoTime.optional(),
    author: AuthorSlug,
  })
  .loose();
export const BugRecord = z
  .object({
    schema_version: SchemaVersion,
    id: RecordId,
    ticket: TicketId,
    title: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    status: RecordStatus.default("open"),
    found_in: z.string().optional(),
    fixed_in: z.string().optional(),
    date: IsoTime,
    author: AuthorSlug,
  })
  .loose();
export const GapRecord = z
  .object({
    schema_version: SchemaVersion,
    id: RecordId,
    ticket: TicketId,
    text: z.string(),
    category: z.string().default("general"),
    status: RecordStatus.default("open"),
    date: IsoTime,
    author: AuthorSlug,
  })
  .loose();
export type DecisionRecord = z.infer<typeof DecisionRecord>;
export type QuestionRecord = z.infer<typeof QuestionRecord>;
export type BugRecord = z.infer<typeof BugRecord>;
export type GapRecord = z.infer<typeof GapRecord>;
export type TicketRecord = DecisionRecord | QuestionRecord | BugRecord | GapRecord;
export type RecordKindName = "decision" | "question" | "bug" | "gap";

export const CommentLine = z.object({ ts: IsoTime, author: AuthorSlug, text: z.string() }).loose();
export type CommentLine = z.infer<typeof CommentLine>;

export const Task = z
  .object({
    id: TaskId,
    slice: z.string().regex(/^S\d+$/),
    title: z.string(),
    layer: Layer,
    acs: z.array(z.string()).default([]),
    estimate_h: z.number().optional(),
    actual_h: z.number().optional(),
    status: z.enum(["todo", "doing", "done", "blocked"]).default("todo"),
    depends: z.array(TaskId).default([]),
    files: z.array(z.string()).default([]),
  })
  .loose();
export type Task = z.infer<typeof Task>;
export const TasksToml = z.object({ schema_version: SchemaVersion, ticket: TicketId, task: z.array(Task).default([]) }).loose();
export type TasksToml = z.infer<typeof TasksToml>;

export const TodoRecord = z
  .object({
    schema_version: SchemaVersion,
    id: TodoId,
    text: z.string(),
    status: z.enum(["open", "done"]).default("open"),
    priority: Priority.default("normal"),
    due: IsoDate.optional(),
    ticket: TicketId.optional(),
    created: IsoTime,
    author: AuthorSlug,
    /** Derived from where the file lives; written for readers, never trusted over the location. */
    scope: Scope.default("personal"),
  })
  .loose();
export type TodoRecord = z.infer<typeof TodoRecord>;

// ---------- logs ----------
export const WorkLogEntry = z
  .object({
    ticket: z.string().default("-"),
    category: Category,
    text: z.string().max(200),
    weight: z.number().int().min(1).max(5).optional(),
    hours: z.number().positive().optional(),
    logged: IsoTime,
  })
  .loose();
export const WorkLogDay = z
  .object({
    schema_version: SchemaVersion,
    day: z.object({ date: IsoDate, author: AuthorSlug, day_hours: z.number().optional() }).loose(),
    entry: z.array(WorkLogEntry).default([]),
  })
  .loose();
export type WorkLogEntry = z.infer<typeof WorkLogEntry>;
export type WorkLogDay = z.infer<typeof WorkLogDay>;

export const ActivityLine = z
  .object({
    ts: IsoTime,
    actor: z.object({ kind: z.enum(["person", "agent"]), id: z.string() }),
    on_behalf_of: AuthorSlug,
    verb: z.string(),
    entity: z.string().optional(),
    code: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    dry_run: z.boolean().optional(),
  })
  .loose();
export type ActivityLine = z.infer<typeof ActivityLine>;
