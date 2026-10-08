// `hl run report` (F154): the agent ends its run with a structured outcome instead of prose the console would have to
// guess at. Inside a run the run id comes from HL_RUN_ID. A run started by the server (HL_SERVER_URL and HL_HOOK_TOKEN
// set, Claude runs) posts the outcome to the server, which records it live. Otherwise (a CLI `hl run`, or a Cursor run
// whose environment never sees the hook token) the outcome is written to runs/<id>.report.json and picked up when
// the run ends; a run that has already ended gets it in its record at once.
import type { Actor, Context, RunOutcome, VerbDef } from "@helmlock/core";
import { fail, ok } from "@helmlock/core";
import { z } from "zod";

export const OUTCOMES = ["done", "review", "blocked", "needs-input"] as const;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;
export const HOOK_TOKEN_HEADER = "X-Helmlock-Hook-Token";
/** The internal endpoint the verb posts to from a server-started run. */
export const REPORT_PATH = "/api/v1/hooks/run-report";

/** In a sub folder so the runs/*.json record listings never see it. */
export const reportFile = (id: string) => `runs/reports/${id}.json`;
/** The line every run brief ends with (the crew plugin adds it; F154). */
export const REPORT_INSTRUCTION =
  'When you finish, call `hl run report --outcome done|review|blocked|needs-input --summary "<one sentence>"` and add `--next "<next step>" --next-role <role>` when you know them.';
export const recordFile = (id: string) => `runs/${id}.json`;

export const RunReportInput = z.object({
  outcome: z.enum(OUTCOMES),
  summary: z.string().trim().min(1, "say in one sentence what happened").max(2000),
  next: z.string().trim().min(1).max(500).optional(),
  next_role: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]*$/, "a role id such as verifier")
    .optional(),
  /** Defaults to HL_RUN_ID (set for every agent run). */
  run: z.string().trim().optional(),
});

export function outcomeOf(input: { outcome: RunOutcome["outcome"]; summary: string; next?: string | undefined; next_role?: string | undefined }): RunOutcome {
  return {
    outcome: input.outcome,
    summary: input.summary,
    ...(input.next ? { next: input.next } : {}),
    ...(input.next_role ? { next_role: input.next_role } : {}),
  };
}

export const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** "Builder: [done] Slice 1 built. Next: verify slice 1 (verifier)" */
export function outcomeComment(role: string | undefined, o: RunOutcome): string {
  const who = role ? `${roleLabel(role)}: ` : "";
  const summary = o.summary.trim().replace(/\.?$/, ".");
  const next = o.next ? ` Next: ${o.next}${o.next_role ? ` (${o.next_role})` : ""}` : o.next_role ? ` Next: ${o.next_role}` : "";
  return `${who}[${o.outcome}] ${summary}${next}`;
}

/**
 * The ticket comment (authored by the role, on behalf of the responsible person) and, unless the report came through
 * the verb (which writes its own), an activity line. Failures are returned, never thrown: the outcome is already kept.
 */
export async function writeOutcome(
  ctx: Context,
  run: { id: string; ticket?: string | undefined; role?: string | undefined; agent?: string | undefined; runtime: string; responsible?: string | undefined },
  o: RunOutcome,
  opts: { activity: boolean },
): Promise<string[]> {
  const problems: string[] = [];
  const role = run.role ?? run.agent;
  const person = run.responsible ?? (ctx.has("workspace") ? ctx.get("workspace").author : undefined);
  const actor: Actor = { kind: "agent", id: role ?? run.runtime, onBehalfOf: person ?? "unknown" };
  if (run.ticket && ctx.has("tickets")) {
    try {
      await ctx.get("tickets").comment(run.ticket, outcomeComment(role, o), actor);
    } catch (e) {
      problems.push(`ticket comment not written: ${(e as Error).message}`);
    }
  }
  if (opts.activity && person && ctx.has("activity")) {
    try {
      await ctx
        .get("activity")
        .append({ actor: { kind: "agent", id: actor.id }, on_behalf_of: person, verb: "run report", entity: run.ticket ?? run.id, code: 0 });
    } catch (e) {
      problems.push(`activity line not written: ${(e as Error).message}`);
    }
  }
  return problems;
}

/** Reads and removes runs/<id>.report.json; undefined when there is none or it is broken. */
export async function takeReportFile(ctx: Context, id: string): Promise<{ outcome: RunOutcome; by: string } | undefined> {
  const files = ctx.get("files");
  const rel = reportFile(id);
  if (!(await files.exists(rel))) return undefined;
  try {
    const raw = JSON.parse(await files.readText(rel)) as { outcome?: unknown; by?: unknown };
    const parsed = RunReportInput.omit({ run: true }).safeParse(raw.outcome);
    await files.remove(rel).catch(() => {});
    return parsed.success ? { outcome: outcomeOf(parsed.data), by: typeof raw.by === "string" ? raw.by : "agent" } : undefined;
  } catch {
    return undefined;
  }
}

export interface RunReportVerbOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export function createRunReportVerb(o: RunReportVerbOptions = {}): VerbDef {
  const def: VerbDef<typeof RunReportInput> = {
    id: "run report",
    summary: "End an agent run with its outcome (done, review, blocked or needs-input), a one-line summary and the next step.",
    examples: [
      'hl run report --outcome done --summary "Slice 1 built, tests pass" --next "verify slice 1" --next-role verifier',
      'hl run report --outcome needs-input --summary "Which currency do refunds use?"',
    ],
    input: RunReportInput,
    writes: true,
    async run(v, input) {
      const env = o.env ?? process.env;
      const id = input.run ?? env.HL_RUN_ID;
      if (!id)
        return fail("no-run", "no run to report on: HL_RUN_ID is not set", { fix: "call hl run report from inside an agent run, or pass --run <run id>" });
      if (!RUN_ID.test(id)) return fail("bad-id", `not a run id: ${id}`);
      const outcome = outcomeOf(input);
      const by = env.HL_ROLE || v.actor.id;
      const text = `run ${id}: [${outcome.outcome}] ${outcome.summary}`;
      if (v.dryRun) return ok({ id, ...outcome }, `would report ${text}`);

      // 1. A server-started run: the server records it live (outcome event, comment).
      if (env.HL_SERVER_URL && env.HL_HOOK_TOKEN && !input.run) {
        try {
          const res = await (o.fetch ?? fetch)(new URL(REPORT_PATH, env.HL_SERVER_URL), {
            method: "POST",
            headers: { "content-type": "application/json", [HOOK_TOKEN_HEADER]: env.HL_HOOK_TOKEN },
            body: JSON.stringify({ run_id: id, by, ...outcome }),
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) return ok({ id, ...outcome, via: "server" }, `reported ${text}`);
          const body = (await res.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
          if (res.status !== 404) return fail("report-refused", `the server refused the report: ${body?.error?.message ?? res.status}`);
        } catch {
          /* the server is gone: fall back to the file */
        }
      }
      // 2. A run that already ended: straight into its record and the ticket.
      const files = v.ctx.get("files");
      if (await files.exists(recordFile(id))) {
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(await files.readText(recordFile(id))) as Record<string, unknown>;
        } catch {
          return fail("bad-record", `${recordFile(id)} is not valid JSON`);
        }
        record.outcome = outcome;
        await files.writeText(recordFile(id), `${JSON.stringify(record, null, 2)}\n`);
        const s = (k: string) => (typeof record[k] === "string" ? (record[k] as string) : undefined);
        const problems = await writeOutcome(
          v.ctx,
          { id, ticket: s("ticket"), role: s("role"), agent: s("agent"), runtime: s("runtime") ?? "agent", responsible: s("responsible") },
          outcome,
          { activity: false },
        );
        return ok({ id, ...outcome, via: "record", problems }, `reported ${text}${problems.length ? ` (${problems.join("; ")})` : ""}`);
      }
      // 3. A live run without a server channel: picked up when the run ends.
      if (!(await files.exists("runs/.gitignore"))) await files.writeText("runs/.gitignore", "*\n");
      await files.writeText(reportFile(id), `${JSON.stringify({ outcome, by, ts: new Date().toISOString() }, null, 2)}\n`);
      return ok({ id, ...outcome, via: "file" }, `reported ${text} (recorded when the run ends)`);
    },
  };
  return def as unknown as VerbDef;
}
