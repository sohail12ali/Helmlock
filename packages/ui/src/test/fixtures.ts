// Typed fixture JSON mirroring test/fixtures/ws-demo, shaped by the frozen contract (types only).
import type {
  ActivityLine,
  ArtifactContent,
  ArtifactRef,
  Board,
  Overview,
  RunList,
  SearchResults,
  SkillList,
  StageDef,
  TicketCard,
  TicketDetail,
  WorkLogLine,
  WorkspaceSummary,
} from "@helmlock/core/contracts";

const ROOT = "D:/ws-demo";
const TODAY = "2026-10-07";

export const workspace: WorkspaceSummary = {
  name: "Test",
  console_name: "Test Console",
  author: { id: "sam", name: "Sam Abbott", initials: "sa" },
  root: ROOT,
  delivery: "D:/helmlock",
  folders: [
    { name: "knowledge", path: ROOT, layer: "workspace" },
    { name: "system", path: "D:/helmlock", layer: "system" },
  ],
  version: { api: 1, helmlock: "0.2.0" },
};

const STAGES: StageDef[] = [
  { id: "backlog", label: "Backlog", agent: "analyst" },
  { id: "spec", label: "Spec", agent: "analyst" },
  { id: "plan", label: "Plan", agent: "planner" },
  { id: "build", label: "Build", agent: "builder", wip: 6 },
  { id: "verify", label: "Verify", agent: "verifier", wip: 5 },
  { id: "done", label: "Done", terminal: true },
];

const card = (c: Partial<TicketCard> & Pick<TicketCard, "id" | "title" | "stage">): TicketCard => ({
  priority: "normal",
  owner: "sam",
  blocked: false,
  open_questions: 0,
  open_bugs: 0,
  tasks: { total: 0, done: 0 },
  updated: `${TODAY}T10:09:30.000Z`,
  ...c,
});

export const cards: TicketCard[] = [
  card({ id: "T-001-sa", title: "Gift card redemption at checkout", stage: "spec", size: "M", priority: "high", claimed_by: "sam", open_questions: 1 }),
  card({ id: "T-002-sa", title: "Export orders to CSV", stage: "build", size: "S", tasks: { total: 2, done: 1 } }),
  card({ id: "T-003-sa", title: "Customer login with email link", stage: "backlog", size: "L" }),
  card({
    id: "T-004-sa",
    title: "Fix rounding in tax totals",
    stage: "spec",
    size: "S",
    priority: "urgent",
    blocked: true,
    blocked_by: "Finance to confirm rounding rule",
    open_bugs: 1,
  }),
  card({ id: "T-005-sa", title: "Store opening hours page", stage: "backlog", size: "S" }),
];

const counted = STAGES.map((s) => ({ ...s, count: cards.filter((c) => c.stage === s.id).length }));

export const board: Board = { stages: counted, tickets: cards };

export const activity: ActivityLine[] = [
  { ts: `${TODAY}T10:09:27.474Z`, actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "ticket move", entity: "T-001-sa", code: 0 },
  { ts: `${TODAY}T10:09:27.767Z`, actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "question add", entity: "T-001-sa", code: 0 },
  { ts: `${TODAY}T10:09:28.155Z`, actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "decision add", entity: "T-001-sa", code: 0 },
  { ts: `${TODAY}T10:09:30.701Z`, actor: { kind: "person", id: "sam" }, on_behalf_of: "sam", verb: "ticket block", entity: "T-004-sa", code: 0 },
];

export const worklog: WorkLogLine[] = [
  { date: TODAY, author: "sam", ticket: "T-001-sa", category: "Development", text: "Wrote the gift card spec and the first decision", hours_alloc: 4.75 },
  { date: TODAY, author: "sam", ticket: "T-002-sa", category: "Development", text: "Planned the CSV export in one slice", hours_alloc: 3.25 },
];

export const runs: RunList = [
  {
    id: "r-0002",
    ticket: "T-001-sa",
    runtime: "claude",
    agent: "analyst",
    mode: "auto-review",
    started: `${TODAY}T11:00:00.000Z`,
    ended: `${TODAY}T11:04:12.000Z`,
    ok: true,
    first_result_line: "Spec drafted, 1 open question added",
    usage: { input_tokens: 80_000, output_tokens: 11_000, cost_usd: 0.42 },
  },
  {
    id: "r-0001",
    runtime: "cursor",
    agent: "builder",
    mode: "plan",
    started: `${TODAY}T09:00:00.000Z`,
    ended: `${TODAY}T09:00:40.000Z`,
    ok: true,
    first_result_line: "No-op: nothing to do",
    usage: { input_tokens: 8_000, output_tokens: 1_000, cost_usd: null },
  },
];

export const overview: Overview = {
  needs_you: [
    {
      kind: "question",
      ticket: "T-001-sa",
      id: "Q-001-sa",
      title: "Can a customer use two gift cards on one order?",
      detail: "Blocking: spec cannot move to plan",
    },
    { kind: "blocked", ticket: "T-004-sa", title: "T-004-sa blocked: Finance to confirm rounding rule", detail: "Next: Ask finance on Monday" },
  ],
  stages: counted,
  in_progress: 3,
  done_this_week: 0,
  today: { date: TODAY, worklog, activity },
  runs,
};

const art = (
  ticket: string,
  file: string,
  kind: ArtifactRef["kind"],
  group: ArtifactRef["group"],
  size: number,
  title = file.split("/").pop()!,
): ArtifactRef => ({
  id: file.replace(/\//g, "~"),
  title,
  kind,
  path: `artifacts/${ticket}/${file}`,
  group,
  size,
});

const t1Artifacts: ArtifactRef[] = [
  art("T-001-sa", "T-001-sa-spec.md", "md", "docs", 512, "Spec"),
  art("T-001-sa", "ticket.toml", "toml", "other", 320),
  art("T-001-sa", "decisions/D-001-sa.toml", "toml", "decisions", 260, "D-001-sa Where the balance lives"),
  art("T-001-sa", "questions/Q-001-sa.toml", "toml", "questions", 230, "Q-001-sa Two gift cards?"),
  art("T-001-sa", "comments.jsonl", "jsonl", "other", 90, "Comments"),
  art("T-001-sa", "brief.html", "html", "docs", 120, "Brief"),
];

export const artifactText: Record<string, string> = {
  "T-001-sa-spec.md":
    "# T-001-sa Gift card redemption\n\n## Summary\nLet customers redeem a gift card balance at checkout.\n\n## Acceptance criteria\n- **AC-1** Given a 50.00 card and a 30.00 order, when placed, then the card has 20.00 left.\n\n<script>alert(1)</script>\n",
  "ticket.toml":
    'schema_version = 1\n\n[ticket]\nid = "T-001-sa"\ntitle = "Gift card redemption at checkout"\nstage = "spec"\n\n[flags]\nblocked = false\n\n[links]\nrelated = []\n',
  "decisions~D-001-sa.toml":
    'schema_version = 1\nid = "D-001-sa"\nticket = "T-001-sa"\ntitle = "Where the balance lives"\nstatus = "accepted"\nchosen = "Gift card service"\nwhy = "One source of truth"\nrejected = ["Order table"]\n',
  "questions~Q-001-sa.toml":
    'schema_version = 1\nid = "Q-001-sa"\ntext = "Can a customer use two gift cards on one order?"\nblocking = true\nstatus = "open"\n',
  "comments.jsonl": '{"ts":"2026-10-07T10:09:31.574Z","author":"sam","text":"Spec draft ready for review"}\n',
  "brief.html": "<h1>Brief</h1><script>parent.hacked = true</script>",
};

export function artifactContent(ticket: string, id: string): ArtifactContent | undefined {
  const ref = details[ticket]?.artifacts.find((a) => a.id === id);
  const text = artifactText[id];
  return ref && text !== undefined ? { ref, text } : undefined;
}

const digest = (c: TicketCard, extra: Partial<TicketDetail["digest"]> = {}): TicketDetail["digest"] => ({
  ticket: { id: c.id, title: c.title, stage: c.stage, size: c.size, priority: c.priority, owner: c.owner },
  blocked: { blocked: c.blocked, by: c.blocked_by },
  open_questions: [],
  open_bugs: [],
  tasks: { total: c.tasks.total, done: c.tasks.done },
  next: [],
  files: [],
  ...extra,
});

export const details: Record<string, TicketDetail> = {
  "T-001-sa": {
    card: cards[0]!,
    ticket: { schema_version: 1, ticket: { id: "T-001-sa", stage: "spec" }, flags: { blocked: false }, links: { related: [] } },
    digest: digest(cards[0]!, {
      claim: { by: "sam", at: `${TODAY}T10:09:31.286Z` },
      open_questions: [{ id: "Q-001-sa", text: "Can a customer use two gift cards on one order?", blocking: true }],
      next: ["Answer Q-001-sa"],
    }),
    records: [
      {
        kind: "decision",
        path: "artifacts/T-001-sa/decisions/D-001-sa.toml",
        schema_version: 1,
        id: "D-001-sa",
        ticket: "T-001-sa",
        title: "Where the balance lives",
        chosen: "Gift card service",
        why: "One source of truth",
        rejected: ["Order table"],
        status: "accepted",
        date: `${TODAY}T10:09:28.149Z`,
        author: "sam",
      },
      {
        kind: "question",
        path: "artifacts/T-001-sa/questions/Q-001-sa.toml",
        schema_version: 1,
        id: "Q-001-sa",
        ticket: "T-001-sa",
        text: "Can a customer use two gift cards on one order?",
        blocking: true,
        options: [],
        status: "open",
        asked: `${TODAY}T10:09:27.759Z`,
        author: "sam",
      },
    ],
    tasks: [],
    comments: [{ ts: `${TODAY}T10:09:31.574Z`, author: "sam", text: "Spec draft ready for review" }],
    artifacts: t1Artifacts,
    next_gate: {
      to: "plan",
      gate: {
        allowed: false,
        reasons: [{ rule: "gate:no-blocking-questions", message: "Q-001-sa is open and blocking", fix: 'hl question answer Q-001-sa "<answer>"' }],
      },
    },
  },
  "T-002-sa": {
    card: cards[1]!,
    ticket: { schema_version: 1, ticket: { id: "T-002-sa", stage: "build" } },
    digest: digest(cards[1]!, { tasks: { total: 2, done: 1, next: "S1-T2" } }),
    records: [],
    tasks: [
      { id: "S1-T1", slice: "S1", title: "CSV endpoint", layer: "api", acs: ["AC-1"], status: "done", depends: [], files: [] },
      { id: "S1-T2", slice: "S1", title: "Export button", layer: "ui", acs: ["AC-1"], status: "todo", depends: [], files: [] },
    ],
    comments: [],
    artifacts: [art("T-002-sa", "T-002-sa-spec.md", "md", "docs", 80, "Spec"), art("T-002-sa", "tasks.toml", "toml", "tasks", 300)],
    next_gate: { to: "verify", gate: { allowed: false, reasons: [{ rule: "gate:tasks-done", message: "1 of 2 tasks not done" }] } },
  },
  "T-004-sa": {
    card: cards[3]!,
    ticket: {
      schema_version: 1,
      ticket: { id: "T-004-sa" },
      flags: { blocked: true, blocked_by: "Finance to confirm rounding rule", next_action: "Ask finance on Monday" },
    },
    digest: digest(cards[3]!, {
      blocked: { blocked: true, by: "Finance to confirm rounding rule", next: "Ask finance on Monday" },
      open_bugs: [{ id: "B-001-sa", title: "Totals off by 0.01 on mixed carts" }],
    }),
    records: [
      {
        kind: "bug",
        path: "artifacts/T-004-sa/bugs/B-001-sa.toml",
        schema_version: 1,
        id: "B-001-sa",
        ticket: "T-004-sa",
        title: "Totals off by 0.01 on mixed carts",
        severity: "high",
        status: "open",
        date: `${TODAY}T10:09:31.015Z`,
        author: "sam",
      },
    ],
    tasks: [],
    comments: [],
    artifacts: [art("T-004-sa", "ticket.toml", "toml", "other", 330)],
    next_gate: {
      to: "plan",
      gate: { allowed: false, reasons: [{ rule: "gate:not-blocked", message: "ticket is blocked: Finance to confirm rounding rule" }] },
    },
  },
};

export const skills: SkillList = [
  { name: "spec", description: "Owns a ticket's living spec", layer: "system", folder: "system", path: "D:/helmlock/.claude/skills/spec/SKILL.md" },
];

export const search: SearchResults = [{ path: "artifacts/T-001-sa/T-001-sa-spec.md", line: 4, text: "Let customers redeem a gift card balance at checkout." }];
