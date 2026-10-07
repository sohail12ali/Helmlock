// Context digests (Blueprint 10, F91, F126): a ticket digest for `hl context <T>` and a small session digest
// for the SessionStart hook. Agents read these instead of the ticket files.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  BugRecord,
  Context,
  ContextService,
  LayerName,
  PluginModule,
  QuestionRecord,
  SessionDigest,
  StageDef,
  Task,
  TicketDigest,
  VerbDef,
} from "@helmlock/core";
import { z } from "zod";

export const SESSION_ROWS = 12;
export const SESSION_CHARS = 1200;
const DEFAULT_STAGES = ["backlog", "spec", "plan", "build", "verify", "done"];

function stagesOf(ctx: Context): StageDef[] {
  if (ctx.has("workflow")) {
    try {
      const s = ctx.get("workflow").stages();
      if (s.length) return s;
    } catch {
      // a stub workflow falls back to the default lanes
    }
  }
  return DEFAULT_STAGES.map((id) => ({ id, label: id, terminal: id === "done" }));
}

/** The first task not done whose dependencies are all done. */
export function nextTask(tasks: readonly Task[]): Task | undefined {
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return tasks.find((t) => t.status === "doing") ?? tasks.find((t) => t.status === "todo" && t.depends.every((d) => done.has(d)));
}

async function listFiles(root: string, dir: string): Promise<string[]> {
  const abs = join(root, dir);
  try {
    const ents = await readdir(abs, { withFileTypes: true, recursive: true });
    return ents
      .filter((e) => e.isFile())
      .map((e) => relative(abs, join(e.parentPath, e.name)).replace(/\\/g, "/"))
      .sort();
  } catch {
    return [];
  }
}

export function createContext(ctx: Context): ContextService {
  return {
    async ticket(id) {
      for (const key of ["tickets", "records"] as const)
        if (!ctx.has(key))
          throw Object.assign(new Error(`no plugin provides the ${key} service, so there is no ticket digest`), {
            rule: "pending-service",
            fix: "enable a tickets plugin in workspace.toml and run hl doctor",
          });
      const t = await ctx.get("tickets").get(id);
      const records = await ctx.get("records").list(id);
      const tasks = ctx.has("tasks") ? await ctx.get("tasks").list(id) : [];
      const questions = records.filter((r) => r.kind === "question" && r.status === "open") as unknown as (QuestionRecord & { kind: "question" })[];
      const bugs = records.filter((r) => r.kind === "bug" && r.status === "open") as unknown as (BugRecord & { kind: "bug" })[];
      const gaps = records.filter((r) => r.kind === "gap" && r.status === "open");
      const nt = nextTask(tasks);

      const next: string[] = [];
      const stages = stagesOf(ctx);
      const idx = stages.findIndex((s) => s.id === t.ticket.stage);
      const terminal = stages[idx]?.terminal ?? t.ticket.stage === "done";
      if (t.flags.blocked) next.push(`unblock: ${t.flags.next_action ?? `waiting on ${t.flags.blocked_by ?? "someone"}`}`);
      for (const q of questions.filter((q) => q.blocking)) next.push(`answer ${q.id}`);
      for (const b of bugs) next.push(`fix ${b.id}`);
      for (const g of gaps) next.push(`close gap ${g.id}`);
      if (nt) next.push(`${nt.status === "doing" ? "finish" : "start"} ${nt.id} ${nt.title}`);
      const following = stages[idx + 1];
      if (!terminal && following && !t.flags.blocked && !questions.some((q) => q.blocking) && !bugs.length && !nt) next.push(`move to ${following.id}`);
      if (!t.claim && !terminal) next.push(`claim ${t.ticket.id}`);

      const digest: TicketDigest = {
        ticket: {
          id: t.ticket.id,
          title: t.ticket.title,
          stage: t.ticket.stage,
          ...(t.ticket.size ? { size: t.ticket.size } : {}),
          priority: t.ticket.priority,
          ...(t.ticket.owner ? { owner: t.ticket.owner } : {}),
          ...(t.ticket.project ? { project: t.ticket.project } : {}),
          ...(t.ticket.goal ? { goal: t.ticket.goal } : {}),
        },
        blocked: {
          blocked: t.flags.blocked,
          ...(t.flags.blocked_by ? { by: t.flags.blocked_by } : {}),
          ...(t.flags.next_action ? { next: t.flags.next_action } : {}),
        },
        ...(t.claim ? { claim: { by: t.claim.claimed_by, at: t.claim.claimed_at } } : {}),
        open_questions: questions.map((q) => ({ id: q.id, text: q.text, blocking: q.blocking })),
        open_bugs: bugs.map((b) => ({ id: b.id, title: b.title })),
        tasks: { total: tasks.length, done: tasks.filter((x) => x.status === "done").length, ...(nt ? { next: `${nt.id} ${nt.title}` } : {}) },
        next,
        files: await listFiles(ctx.get("workspace").root, t.dir),
      };
      return digest;
    },

    async session() {
      const stages = stagesOf(ctx);
      const first = stages[0]?.id ?? "backlog";
      const terminal = new Set(stages.filter((s) => s.terminal).map((s) => s.id));
      if (!terminal.size) terminal.add("done");
      const in_flight: SessionDigest["in_flight"] = [];
      const waiting: string[] = [];
      if (ctx.has("tickets")) {
        const all = (await ctx.get("tickets").list()).filter((t) => t.ticket.stage !== first && !terminal.has(t.ticket.stage));
        const order = (s: string) => stages.findIndex((x) => x.id === s);
        all.sort(
          (a, b) =>
            Number(b.flags.blocked) - Number(a.flags.blocked) || order(b.ticket.stage) - order(a.ticket.stage) || a.ticket.id.localeCompare(b.ticket.id),
        );
        for (const t of all.slice(0, SESSION_ROWS)) in_flight.push({ id: t.ticket.id, title: t.ticket.title, stage: t.ticket.stage, blocked: t.flags.blocked });
        if (ctx.has("records")) {
          for (const t of all) {
            if (waiting.length >= SESSION_ROWS) break;
            const recs = await ctx.get("records").list(t.ticket.id, "question");
            for (const q of recs as unknown as QuestionRecord[]) if (q.status === "open" && q.blocking) waiting.push(`${q.id} (${t.ticket.id}): ${q.text}`);
          }
        }
      }
      const skills: Record<LayerName, string[]> = { system: [], workspace: [], project: [], personal: [], local: [] };
      if (ctx.has("skills")) {
        for (const s of await ctx.get("skills").list()) {
          const label = s.layer === "project" ? `${s.folder}/${s.name}` : s.name;
          if (!skills[s.layer].includes(label)) skills[s.layer].push(label);
        }
      }
      return { in_flight, skills, waiting: waiting.slice(0, SESSION_ROWS) };
    },
  };
}

/** Text form of the session digest, capped at about 12 rows and 1,200 characters (F126). */
export function sessionText(d: SessionDigest, maxChars = SESSION_CHARS): string {
  const lines: string[] = [];
  lines.push(d.in_flight.length ? `In flight (${d.in_flight.length}):` : "In flight: none");
  for (const t of d.in_flight.slice(0, SESSION_ROWS)) lines.push(`  ${t.id} ${t.stage}${t.blocked ? " BLOCKED" : ""}  ${t.title}`);
  if (d.waiting.length) lines.push(`Waiting: ${d.waiting.length} blocking question(s)`, ...d.waiting.slice(0, 3).map((w) => `  ${w}`));
  const sk = (["system", "workspace", "project"] as const).map(
    (l) => `${l} ${d.skills[l].length}${d.skills[l].length && l !== "system" ? ` (${d.skills[l].join(", ")})` : ""}`,
  );
  lines.push(`Skills: ${sk.join(" | ")}`);
  let out = "";
  for (const l of lines.map((x) => (x.length > 160 ? `${x.slice(0, 157)}...` : x))) {
    if (out.length + l.length + 1 > maxChars - 20) {
      out += "... (more: hl context --session --json)";
      break;
    }
    out += `${out ? "\n" : ""}${l}`;
  }
  return out;
}

export function ticketText(d: TicketDigest): string {
  const t = d.ticket;
  const lines = [
    `${t.id}  ${t.title}`,
    `stage ${t.stage}  priority ${t.priority}${t.size ? `  size ${t.size}` : ""}${t.owner ? `  owner ${t.owner}` : ""}${t.project ? `  project ${t.project}` : ""}`,
  ];
  if (d.blocked.blocked) lines.push(`BLOCKED by ${d.blocked.by ?? "?"}; next: ${d.blocked.next ?? "?"}`);
  if (d.claim) lines.push(`claimed by ${d.claim.by} at ${d.claim.at}`);
  if (d.open_questions.length) lines.push("open questions:", ...d.open_questions.map((q) => `  ${q.id}${q.blocking ? " (blocking)" : ""} ${q.text}`));
  if (d.open_bugs.length) lines.push("open bugs:", ...d.open_bugs.map((b) => `  ${b.id} ${b.title}`));
  lines.push(`tasks ${d.tasks.done}/${d.tasks.total} done${d.tasks.next ? `; next ${d.tasks.next}` : ""}`);
  if (d.next.length) lines.push(`next: ${d.next.join("; ")}`);
  if (d.files.length) lines.push(`files: ${d.files.join(", ")}`);
  return lines.join("\n");
}

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

const contextVerb = verb({
  id: "context",
  summary: "Print a digest: of a ticket (stage, blocked, open questions, next, files) or, with --session, of the work in flight.",
  examples: ["hl context T-014-sa", "hl context T-014-sa --json", "hl context --session"],
  args: ["ticket"],
  input: z
    .object({ ticket: z.string().optional(), session: z.preprocess((v) => v === true || v === "true", z.boolean()).optional() })
    .refine((i) => Boolean(i.ticket) !== Boolean(i.session), { message: "give a ticket id or --session (not both)" }),
  writes: false,
  async run(v, input) {
    const svc = v.ctx.get("context");
    if (input.session) {
      const d = await svc.session();
      return { ok: true, data: d, text: sessionText(d) };
    }
    const d = await svc.ticket(input.ticket as string);
    return { ok: true, data: d, text: ticketText(d) };
  },
});

const plugin: PluginModule = {
  name: "context",
  // tickets, records, tasks and skills are read when a digest is asked for, so a missing provider
  // names itself ("pending service: tickets") instead of leaving the verb unregistered.
  requires: ["files", "verbs", "workspace"],
  async apply(ctx) {
    ctx.provide("context", createContext(ctx));
    await ctx.effect(() => ctx.get("verbs").register(contextVerb));
  },
};

export default plugin;
