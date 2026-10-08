// `run attach` (Blueprint 31): runs are local (runs/<id>.json and runs/<id>.events.jsonl, gitignored). Attaching
// one copies the record and a short transcript summary (text and result lines only, never stderr) into the ticket,
// artifacts/<T>/runs/<id>.md, which is committed, and leaves a ticket comment.
import type { VerbDef } from "@helmlock/core";
import { ok, TicketId } from "@helmlock/core";
import { z } from "zod";

export const SUMMARY_LINES = 50;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;

function ruleError(rule: string, message: string, fix?: string, file?: string): Error {
  return Object.assign(new Error(message), { rule, ...(fix ? { fix } : {}), ...(file ? { file } : {}) });
}

/** First `max` non-empty lines of the run's text and result events; stderr, tools and raw lines are left out. */
export function transcriptSummary(eventsJsonl: string, max = SUMMARY_LINES): { lines: string[]; cut: boolean } {
  const out: string[] = [];
  let cut = false;
  for (const raw of eventsJsonl.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let ev: { type?: string; text?: unknown } | undefined;
    try {
      const row = JSON.parse(raw) as { event?: { type?: string; text?: unknown } };
      ev = row.event;
    } catch {
      continue;
    }
    if (!ev || (ev.type !== "text" && ev.type !== "result") || typeof ev.text !== "string") continue;
    for (const l of ev.text.split(/\r?\n/)) {
      if (!l.trim()) continue;
      if (out.length >= max) {
        cut = true;
        break;
      }
      out.push(l.trimEnd());
    }
    if (cut) break;
  }
  return { lines: out, cut };
}

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

export function createAttachVerb(): VerbDef {
  return verb({
    id: "run attach",
    summary: "Attach a local agent run to a ticket: copies the run record and a short transcript summary to artifacts/<T>/runs/<id>.md.",
    examples: ["hl run attach run-20261007-142501-a1b2 T-014-sa"],
    args: ["run", "ticket"],
    input: z.object({ run: z.string().trim(), ticket: TicketId }),
    writes: true,
    async run(v, input) {
      if (!RUN_ID.test(input.run)) throw ruleError("bad-id", `not a run id: ${input.run}`);
      const files = v.ctx.get("files");
      const recordRel = `runs/${input.run}.json`;
      if (!(await files.exists(recordRel)))
        throw ruleError("not-found", `no run record ${recordRel} on this machine`, "runs are local; attach from the machine that ran it", recordRel);
      if (!v.ctx.has("tickets")) throw ruleError("not-available", "the tickets plugin is not active", "enable tickets-toml in workspace.toml");
      const tickets = v.ctx.get("tickets");
      const ticket = await tickets.get(input.ticket);
      const recordText = (await files.readText(recordRel)).trim();
      let record: Record<string, unknown> = {};
      try {
        record = JSON.parse(recordText) as Record<string, unknown>;
      } catch {
        throw ruleError("bad-record", `${recordRel} is not valid JSON`, undefined, recordRel);
      }
      const eventsRel = `runs/${input.run}.events.jsonl`;
      const summary = (await files.exists(eventsRel)) ? transcriptSummary(await files.readText(eventsRel)) : undefined;
      const field = (k: string) => (record[k] === undefined || record[k] === null ? "-" : String(record[k]));
      const md = [
        `# Run ${input.run}`,
        "",
        `Attached to ${input.ticket} by ${v.actor.onBehalfOf} on ${new Date().toISOString().slice(0, 10)}.`,
        "",
        `- Runtime: ${field("runtime")}; agent: ${field("agent")}; mode: ${field("mode")}; model: ${field("model")}`,
        `- Started: ${field("started")}; ended: ${field("ended")}; ok: ${field("ok")}`,
        `- Responsible: ${field("responsible")}`,
        ...(record.ticket && record.ticket !== input.ticket ? [`- The run was started for ${field("ticket")}.`] : []),
        "",
        "## Transcript summary",
        "",
        ...(summary
          ? summary.lines.length
            ? ["```text", ...summary.lines.map((l) => l.replaceAll("```", "'''")), "```", ...(summary.cut ? ["", `(first ${SUMMARY_LINES} lines only)`] : [])]
            : ["No text or result lines."]
          : ["No transcript was saved for this run (runs from `hl run` keep only the record)."]),
        "",
        "## Run record",
        "",
        "```json",
        recordText,
        "```",
        "",
      ].join("\n");
      const dest = `${ticket.dir}/runs/${input.run}.md`;
      await files.writeText(dest, md, { dryRun: v.dryRun });
      if (!v.dryRun) await tickets.comment(input.ticket, `Attached run ${input.run}`, v.actor);
      return ok(
        { run: input.run, ticket: input.ticket, path: dest },
        `${v.dryRun ? "would attach" : "attached"} run ${input.run} to ${input.ticket} -> ${dest} (committed, visible to the team)`,
      );
    },
  });
}
