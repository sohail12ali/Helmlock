// The S3 verbs from docs/build/m1-verbs.md. Every write verb honours v.dryRun and then returns what it would write.
import { blocked, type Context, fail, ok, type VerbDef, type VerbResult, type WriteResult } from "@helmlock/core";
import { z } from "zod";
import { clean } from "./errors.ts";
import type { Outcome, Store } from "./store.ts";

/** A repeatable flag: one value or many. */
const many = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));
/** A boolean flag that also accepts "true"/"false" from a command line. */
const flag = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((v) => v === true || v === "true");
const num = z.coerce.number().positive().optional();

const writesOf = (o: Outcome<unknown>, dryRun: boolean) =>
  dryRun ? { dry_run: true, would_write: o.writes.map((w: WriteResult) => ({ path: w.path, text: w.text })) } : {};
const dryNote = (o: Outcome<unknown>, dryRun: boolean) => (dryRun ? `\n(dry run) would write: ${o.writes.map((w) => w.path).join(", ") || "nothing"}` : "");

function def<I extends z.ZodType>(d: VerbDef<I>): VerbDef {
  return d as unknown as VerbDef;
}

export function buildVerbs(ctx: Context, store: Store): VerbDef[] {
  void ctx;
  const done = <T>(o: Outcome<T>, dryRun: boolean, text: string, data: Record<string, unknown>): VerbResult =>
    ok({ ...data, ...writesOf(o, dryRun) }, text + dryNote(o, dryRun));

  return [
    def({
      id: "ticket new",
      summary: "Create a ticket in the first workflow stage (ticket.toml only; other files appear when first used).",
      examples: ['hl ticket new "Gift card redemption" --size M --priority high', 'hl ticket new "Fix typo" --size S --dry-run'],
      args: ["title"],
      input: z.object({
        title: z.string().min(1),
        summary: z.string().optional(),
        size: z.enum(["S", "M", "L"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        project: z.string().optional(),
        goal: z.string().optional(),
      }),
      writes: true,
      async run(v, i) {
        const o = await store.create(i, v.actor, v.dryRun);
        const t = o.value;
        // The top-level id names the new ticket as the activity line's entity (registry entityOf).
        return done(o, v.dryRun, `${t.ticket.id}  ${t.ticket.stage}  ${t.ticket.title}`, { id: t.ticket.id, ticket: t });
      },
    }),
    def({
      id: "ticket show",
      summary: "Show one ticket: state, flags, claim, open blockers and tasks.",
      examples: ["hl ticket show T-014-sa", "hl ticket show T-014-sa --json"],
      args: ["id"],
      input: z.object({ id: z.string() }),
      writes: false,
      async run(_v, i) {
        const t = await store.get(i.id);
        const [tasks, blockers, records] = await Promise.all([store.listTasks(i.id), store.blockers(i.id), store.listRecords(i.id)]);
        const counts: Record<string, { total: number; open: number }> = {};
        for (const kind of ["decision", "question", "bug", "gap"]) {
          const mine = records.filter((r) => r.kind === kind);
          counts[kind] = { total: mine.length, open: mine.filter((r) => r.status === "open").length };
        }
        const k = t.ticket;
        const lines = [
          `${k.id}  ${k.title}`,
          `stage ${k.stage}  size ${k.size ?? "-"}  priority ${k.priority}  owner ${k.owner ?? "-"}`,
          t.flags.blocked ? `BLOCKED by ${t.flags.blocked_by}; next: ${t.flags.next_action}` : "",
          t.claim ? `claimed by ${t.claim.claimed_by} at ${t.claim.claimed_at}` : "",
          ...blockers.map((b) => `open ${b.kind} ${b.id}: ${"title" in b ? b.title : "text" in b ? b.text : ""}`),
          tasks.length ? `tasks ${tasks.filter((x) => x.status === "done").length}/${tasks.length} done` : "",
        ].filter(Boolean);
        return ok({ ticket: t, tasks, blockers, records: counts }, lines.join("\n"));
      },
    }),
    def({
      id: "ticket set",
      summary: "Change a ticket's size, priority, title, summary, project or goal (never its stage: use ticket move).",
      examples: ["hl ticket set T-014-sa --size M --priority high", 'hl ticket set T-014-sa --title "Gift card redemption v2" --dry-run'],
      args: ["id"],
      input: z.object({
        id: z.string(),
        size: z.enum(["S", "M", "L"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        title: z.string().min(1).optional(),
        summary: z.string().optional(),
        project: z.string().optional(),
        goal: z.string().optional(),
      }),
      writes: true,
      async run(v, i) {
        const { id, ...patch } = i;
        if (Object.values(patch).every((x) => x === undefined))
          return fail("bad-input", "nothing to set: give --size, --priority, --title, --summary, --project or --goal");
        const o = await store.setFields(id, patch, v.actor, v.dryRun);
        return done(o, v.dryRun, `${id} updated: ${Object.keys(clean(patch)).join(", ")}`, { ticket: o.value });
      },
    }),
    def({
      id: "ticket list",
      summary: "List tickets, optionally by stage or only mine (owner or claimer).",
      examples: ["hl ticket list", "hl ticket list --stage build --mine --json"],
      input: z.object({ stage: z.string().optional(), mine: flag, project: z.string().optional() }),
      writes: false,
      async run(v, i) {
        const owner = i.mine ? (await store.person(v.actor)).id : undefined;
        const list = await store.list({ stage: i.stage, owner, project: i.project });
        const text = list.map((t) => `${t.ticket.id.padEnd(10)} ${t.ticket.stage.padEnd(8)} ${t.flags.blocked ? "BLOCKED " : ""}${t.ticket.title}`).join("\n");
        return ok({ tickets: list }, text || "no tickets");
      },
    }),
    def({
      id: "ticket move",
      summary: "Move a ticket to another stage. Exits 2 when a gate blocks, naming the rule and the fix.",
      examples: ["hl ticket move T-014-sa spec", "hl ticket move T-014-sa build --dry-run"],
      args: ["id", "stage"],
      input: z.object({ id: z.string(), stage: z.string() }),
      writes: true,
      async run(v, i) {
        const o = await store.move(i.id, i.stage, v.actor, v.dryRun);
        const { gate, ticket } = o.value;
        if (!gate.allowed) {
          const first = gate.reasons[0] ?? { rule: "gate", message: "move not allowed" };
          const all = gate.reasons.map((r) => `- ${r.rule}: ${r.message}`).join("\n");
          const extra = { fix: first.fix, file: `${ticket.dir}/ticket.toml` };
          const message = gate.reasons.length > 1 ? `${first.message}\n${all}` : first.message;
          return first.rule === "unknown-stage" ? fail(first.rule, message, extra) : blocked(first.rule, message, extra);
        }
        return done(o, v.dryRun, `${ticket.ticket.id} -> ${ticket.ticket.stage}`, { ticket, gate });
      },
    }),
    def({
      id: "ticket block",
      summary: "Flag a ticket as blocked; needs who or what blocks it and the next action.",
      examples: ['hl ticket block T-014-sa --by "DBA review" --next "Ask Kim to approve the table"'],
      args: ["id"],
      input: z.object({ id: z.string(), by: z.string().min(1), next: z.string().min(1) }),
      writes: true,
      async run(v, i) {
        const o = await store.setBlocked(i.id, { by: i.by, next: i.next }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} blocked by ${i.by}; next: ${i.next}`, { ticket: o.value });
      },
    }),
    def({
      id: "ticket unblock",
      summary: "Clear the blocked flag.",
      examples: ["hl ticket unblock T-014-sa"],
      args: ["id"],
      input: z.object({ id: z.string() }),
      writes: true,
      async run(v, i) {
        const o = await store.setBlocked(i.id, null, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} unblocked`, { ticket: o.value });
      },
    }),
    def({
      id: "ticket claim",
      summary: "Claim a ticket for yourself. A ticket claimed by someone else exits 1 (claim-conflict); never retry.",
      examples: ["hl ticket claim T-014-sa"],
      args: ["id"],
      input: z.object({ id: z.string() }),
      writes: true,
      async run(v, i) {
        const o = await store.claim(i.id, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} claimed by ${o.value.claim?.claimed_by}`, { ticket: o.value });
      },
    }),
    def({
      id: "ticket release",
      summary: "Release your claim on a ticket.",
      examples: ["hl ticket release T-014-sa"],
      args: ["id"],
      input: z.object({ id: z.string() }),
      writes: true,
      async run(v, i) {
        const o = await store.release(i.id, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} released`, { ticket: o.value });
      },
    }),
    def({
      id: "ticket comment",
      summary: "Append a comment to the ticket's comments.jsonl.",
      examples: ['hl ticket comment T-014-sa "Spoke to Kim; table approved"'],
      args: ["id", "text"],
      input: z.object({ id: z.string(), text: z.string().min(1) }),
      writes: true,
      async run(v, i) {
        const o = await store.comment(i.id, i.text, v.actor, v.dryRun);
        return done(o, v.dryRun, `comment added to ${i.id}`, { comment: o.value });
      },
    }),
    def({
      id: "decision add",
      summary: "Record a decision on a ticket (decisions/<D-id>.toml).",
      examples: ['hl decision add T-014-sa "Store cards in SQL" --chosen "new table" --why "audit" --rejected "JSON column"'],
      args: ["ticket", "title"],
      repeatable: ["rejected"],
      input: z.object({ ticket: z.string(), title: z.string().min(1), chosen: z.string().optional(), why: z.string().optional(), rejected: many }),
      writes: true,
      async run(v, i) {
        const o = await store.addRecord(
          "decision",
          i.ticket,
          { title: i.title, chosen: i.chosen, why: i.why, rejected: i.rejected, status: "accepted" },
          v.actor,
          v.dryRun,
        );
        return done(o, v.dryRun, `${o.value.id}  ${i.title}`, { record: o.value });
      },
    }),
    def({
      id: "question add",
      summary: "Ask a question on a ticket; --blocking stops it leaving spec or plan until answered.",
      examples: ['hl question add T-014-sa "Which catalog holds gift cards?" --blocking --option WMS --option AMS'],
      args: ["ticket", "text"],
      repeatable: ["option"],
      input: z.object({ ticket: z.string(), text: z.string().min(1), blocking: flag, option: many }),
      writes: true,
      async run(v, i) {
        const o = await store.addRecord("question", i.ticket, { text: i.text, blocking: i.blocking, options: i.option, status: "open" }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${o.value.id}${i.blocking ? " (blocking)" : ""}  ${i.text}`, { record: o.value });
      },
    }),
    def({
      id: "question answer",
      summary: "Answer a question; it stops blocking.",
      examples: ['hl question answer Q-003-sa "WMS"'],
      args: ["id", "answer"],
      input: z.object({ id: z.string(), answer: z.string().min(1) }),
      writes: true,
      async run(v, i) {
        const o = await store.updateRecord(i.id, { answer: i.answer, status: "answered", answered: new Date().toISOString() }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} answered`, { record: o.value });
      },
    }),
    def({
      id: "bug add",
      summary: "Record a bug on a ticket; open bugs stop verify -> done.",
      examples: ['hl bug add T-014-sa "Redeem twice succeeds" --severity high'],
      args: ["ticket", "title"],
      input: z.object({ ticket: z.string(), title: z.string().min(1), severity: z.enum(["low", "medium", "high", "critical"]).optional() }),
      writes: true,
      async run(v, i) {
        const o = await store.addRecord("bug", i.ticket, { title: i.title, severity: i.severity, status: "open" }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${o.value.id}  ${i.title}`, { record: o.value });
      },
    }),
    def({
      id: "gap add",
      summary: "Record a gap (something missing from the spec or plan) on a ticket.",
      examples: ['hl gap add T-014-sa "No rule for expired cards" --category rules'],
      args: ["ticket", "text"],
      input: z.object({ ticket: z.string(), text: z.string().min(1), category: z.string().optional() }),
      writes: true,
      async run(v, i) {
        const o = await store.addRecord("gap", i.ticket, { text: i.text, category: i.category, status: "open" }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${o.value.id}  ${i.text}`, { record: o.value });
      },
    }),
    def({
      id: "bug resolve",
      summary: "Mark a bug fixed, naming where it was fixed.",
      examples: ['hl bug resolve B-002-sa --fixed-in "commit 1a2b3c"'],
      args: ["id"],
      // The CLI may hand the flag over as fixed-in, fixedIn or fixed_in.
      input: z
        .object({
          id: z.string().regex(/^B-/, "bug ids start with B-"),
          "fixed-in": z.string().min(1).optional(),
          fixedIn: z.string().min(1).optional(),
          fixed_in: z.string().min(1).optional(),
        })
        .transform(({ id, ...r }) => ({ id, fixedIn: r["fixed-in"] ?? r.fixedIn ?? r.fixed_in })),
      writes: true,
      async run(v, i) {
        const o = await store.updateRecord(i.id, { status: "fixed", fixed_in: i.fixedIn }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} fixed${i.fixedIn ? ` in ${i.fixedIn}` : ""}`, { record: o.value });
      },
    }),
    def({
      id: "gap resolve",
      summary: "Close a gap, with a note on how it was closed.",
      examples: ['hl gap resolve G-001-sa --note "Rule added to the spec as AC-4"'],
      args: ["id"],
      input: z.object({ id: z.string().regex(/^G-/, "gap ids start with G-"), note: z.string().min(1).optional() }),
      writes: true,
      async run(v, i) {
        const o = await store.updateRecord(i.id, { status: "closed", note: i.note }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.id} closed`, { record: o.value });
      },
    }),
    def({
      id: "blockers",
      summary: "List open blocking questions, open bugs and open gaps on a ticket.",
      examples: ["hl blockers T-014-sa", "hl blockers T-014-sa --json"],
      args: ["ticket"],
      input: z.object({ ticket: z.string() }),
      writes: false,
      async run(_v, i) {
        const list = await store.blockers(i.ticket);
        const text = list.map((b) => `${b.id}  ${b.kind}  ${"title" in b ? b.title : "text" in b ? b.text : ""}`).join("\n");
        return ok({ blockers: list }, text || "no blockers");
      },
    }),
    def({
      id: "task add",
      summary: "Add a task to a slice in tasks.toml (id S1-T1).",
      examples: [
        'hl task add T-014-sa "Gift card table" --slice S1 --layer db --ac AC-1 --estimate 2',
        'hl task add T-014-sa "Redeem endpoint" --layer api --ac AC-1 --depends S1-T1 --file src/api/redeem.ts',
      ],
      args: ["ticket", "title"],
      repeatable: ["ac", "depends", "file"],
      input: z.object({
        ticket: z.string(),
        title: z.string().min(1),
        slice: z.string().default("S1"),
        layer: z.enum(["db", "api", "ui", "test", "env", "spike", "docs"]),
        ac: many,
        depends: many,
        file: many,
        estimate: num,
      }),
      writes: true,
      async run(v, i) {
        const o = await store.addTask(
          i.ticket,
          { title: i.title, slice: i.slice, layer: i.layer, acs: i.ac, depends: i.depends, files: i.file, estimate_h: i.estimate },
          v.actor,
          v.dryRun,
        );
        return done(o, v.dryRun, `${o.value.id}  ${i.title}`, { task: o.value });
      },
    }),
    def({
      id: "task list",
      summary: "List a ticket's tasks from tasks.toml.",
      examples: ["hl task list T-014-sa", "hl task list T-014-sa --json"],
      args: ["ticket"],
      input: z.object({ ticket: z.string() }),
      writes: false,
      async run(_v, i) {
        const tasks = await store.listTasks(i.ticket);
        const text = tasks
          .map((t) => `${t.id.padEnd(7)} ${t.status.padEnd(7)} ${t.layer.padEnd(5)} ${t.title}${t.acs.length ? `  [${t.acs.join(", ")}]` : ""}`)
          .join("\n");
        return ok({ ticket: i.ticket, tasks }, text || "no tasks");
      },
    }),
    def({
      id: "task set",
      summary: "Change a task's status or record actual hours.",
      examples: ["hl task set T-014-sa S1-T1 --status done --actual 1.5"],
      args: ["ticket", "task"],
      input: z.object({ ticket: z.string(), task: z.string(), status: z.enum(["todo", "doing", "done", "blocked"]).optional(), actual: num }),
      writes: true,
      async run(v, i) {
        if (i.status === undefined && i.actual === undefined) return fail("bad-input", "nothing to set: give --status or --actual");
        const o = await store.setTask(i.ticket, i.task, { status: i.status, actual_h: i.actual }, v.actor, v.dryRun);
        return done(o, v.dryRun, `${i.task}  ${o.value.status}`, { task: o.value });
      },
    }),
  ];
}
