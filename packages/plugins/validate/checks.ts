// Ticket folder checks (ported from lc-wms .kanban/core/layout.py: layout walk + AC trace).
// Reads files directly with node:fs: validation is read-only and must see broken files the services would refuse.
// The per-file path (`file()`) parses only the one file it was given plus at most the ticket.toml / spec it needs,
// and never runs zod, so the PostToolUse hook stays far under its 300 ms budget.
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BugRecord, DecisionRecord, type Finding, GapRecord, QuestionRecord, TasksToml, TicketToml } from "@helmlock/core";
import { parse } from "smol-toml";
import type { z } from "zod";

export interface Rule {
  files?: string[];
  patterns?: string[];
  dirs?: string[] | Record<string, string>;
}
export interface Layout {
  version: number;
  binary_ext?: string[];
  binary_dirs?: string[];
  root: Rule;
  [table: string]: unknown;
}

export const ARTIFACTS = "artifacts";
const TICKET_ID = /^T-\d{3,}-[a-z]{2,3}$/;
const RECORD_ID = /^[DQBG]-\d{3,}-[a-z]{2,3}$/;
const TASK_ID = /^S\d+-T\d+$/;
const AC_RE = /\bAC-\d+\b/g;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

type Kind = "decision" | "question" | "bug" | "gap";
export const RECORD_DIRS: Record<string, { kind: Kind; prefix: string; schema: z.ZodType }> = {
  decisions: { kind: "decision", prefix: "D", schema: DecisionRecord },
  questions: { kind: "question", prefix: "Q", schema: QuestionRecord },
  bugs: { kind: "bug", prefix: "B", schema: BugRecord },
  gaps: { kind: "gap", prefix: "G", schema: GapRecord },
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const err = (rule: string, message: string, file: string, fix?: string): Finding =>
  fix ? { level: "error", rule, message, file, fix } : { level: "error", rule, message, file };
const warn = (rule: string, message: string, file: string, fix?: string): Finding =>
  fix ? { level: "warn", rule, message, file, fix } : { level: "warn", rule, message, file };

const glob = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );

async function text(abs: string): Promise<string | undefined> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return undefined;
  }
}
async function entries(abs: string): Promise<Dirent[]> {
  try {
    return await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

function zodFindings(schema: z.ZodType, data: unknown, rule: string, file: string): Finding[] {
  const r = schema.safeParse(data);
  if (r.success) return [];
  return r.error.issues.map((i) => err(rule, `${i.path.join(".") || "(root)"}: ${i.message}`, file));
}

export interface ValidatorOptions {
  root: string;
  layout: Layout;
  /** Stage ids in workflow order. */
  stages: () => string[];
}

export function createValidator(o: ValidatorOptions) {
  const abs = (rel: string) => join(o.root, rel);
  const relOf = (p: string) => {
    const r = relative(o.root, isAbsolute(p) ? p : resolve(o.root, p));
    return r.split(sep).join("/");
  };
  const stageIndex = (stage: string | undefined) => (stage === undefined ? -1 : o.stages().indexOf(stage));
  const buildIndex = () => {
    const i = o.stages().indexOf("build");
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const verifyIndex = () => {
    const i = o.stages().indexOf("verify");
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };

  // ---------- layout ----------
  const ruleFor = (name: string): Rule => (obj(o.layout[name]) as Rule | undefined) ?? {};
  const subdirs = (r: Rule): Record<string, string> => (Array.isArray(r.dirs) ? Object.fromEntries(r.dirs.map((d) => [d, d])) : (r.dirs ?? {}));
  const fileAllowed = (name: string, r: Rule, tid: string) =>
    (r.files ?? []).some((f) => f.replace("{T}", tid) === name) || (r.patterns ?? []).some((p) => glob(p.replace("{T}", tid)).test(name));

  /** Layout check for one path inside the ticket folder ("questions/Q-001-sa.toml"). */
  function layoutEntry(tid: string, inner: string, file: string): Finding[] {
    const parts = inner.split("/");
    let rule: Rule = o.layout.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = subdirs(rule);
      const target = d[parts[i]!] ?? d["*"];
      if (target === undefined) {
        const allowed = Object.keys(d).filter((k) => k !== "*");
        return [warn("layout", `${parts.slice(0, i + 1).join("/")}/: folder not in the ticket layout (allowed here: ${allowed.join(", ") || "none"})`, file)];
      }
      if (target === "*") return binaryCheck(inner, file);
      rule = ruleFor(target);
    }
    const name = parts[parts.length - 1]!;
    const out = fileAllowed(name, rule, tid) ? [] : [warn("layout", `${inner}: file name not in the ticket layout`, file)];
    return [...out, ...binaryCheck(inner, file)];
  }

  function binaryCheck(inner: string, file: string): Finding[] {
    const ext = inner.slice(inner.lastIndexOf(".")).toLowerCase();
    const homes = o.layout.binary_dirs ?? [];
    if (!(o.layout.binary_ext ?? []).includes(ext)) return [];
    if (homes.includes(inner.split("/")[0]!) && inner.includes("/")) return [];
    return [warn("binary-outside-source", `${inner}: binary inputs belong under ${homes.join(", ")}/`, file)];
  }

  async function walkLayout(tid: string, dirRel: string, inner: string, rule: Rule, out: Finding[]): Promise<void> {
    const d = subdirs(rule);
    for (const e of (await entries(abs(dirRel))).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = inner ? `${inner}/${e.name}` : e.name;
      const file = `${dirRel}/${e.name}`;
      if (e.isDirectory()) {
        const target = d[e.name] ?? d["*"];
        if (target === undefined) {
          const allowed = Object.keys(d).filter((k) => k !== "*");
          out.push(warn("layout", `${path}/: folder not in the ticket layout (allowed here: ${allowed.join(", ") || "none"})`, file));
        } else if (target !== "*") await walkLayout(tid, file, path, ruleFor(target), out);
        continue;
      }
      if (!fileAllowed(e.name, rule, tid)) out.push(warn("layout", `${path}: file name not in the ticket layout`, file));
      out.push(...binaryCheck(path, file));
    }
  }

  // ---------- ticket.toml ----------
  function checkTicket(tid: string, src: string | undefined, file: string, full: boolean): { findings: Finding[]; stage?: string; size?: string } {
    if (src === undefined) return { findings: [err("ticket-missing", `${file} is missing`, file, "every ticket folder needs ticket.toml")] };
    let raw: Raw;
    try {
      raw = parse(src) as Raw;
    } catch (e) {
      return { findings: [err("ticket-parse", `${file} does not parse: ${(e as Error).message.split("\n")[0]}`, file)] };
    }
    const out: Finding[] = [];
    const t = obj(raw.ticket) ?? {};
    const id = str(t.id);
    if (!TICKET_ID.test(tid)) out.push(err("ticket-id", `folder name ${tid} is not a ticket id (T-014-sa)`, file));
    if (!id || !TICKET_ID.test(id)) out.push(err("ticket-id", `ticket.id ${JSON.stringify(id ?? null)} is not a ticket id (T-014-sa)`, file));
    else if (id !== tid) out.push(err("ticket-id", `ticket.id ${id} does not match its folder ${tid}`, file));
    const stage = str(t.stage);
    if (stage !== undefined && o.stages().length && stageIndex(stage) < 0)
      out.push(err("ticket-stage", `unknown stage ${stage}`, file, `use one of: ${o.stages().join(", ")}`));
    const flags = obj(raw.flags);
    if (flags?.blocked === true && (!str(flags.blocked_by)?.trim() || !str(flags.next_action)?.trim())) {
      out.push(
        err(
          "blocked-incomplete",
          `${tid} is blocked but has no ${!str(flags.blocked_by)?.trim() ? "blocked_by" : "next_action"}`,
          file,
          `hl ticket block ${tid} --by "<who>" --next "<action>"`,
        ),
      );
    }
    if (raw.claim !== undefined) {
      const c = obj(raw.claim);
      const by = str(c?.claimed_by);
      const at = str(c?.claimed_at);
      if (!by || !SLUG.test(by) || !at || Number.isNaN(Date.parse(at))) {
        out.push(
          err(
            "claim-fields",
            "[claim] needs claimed_by (a person slug) and claimed_at (an ISO time)",
            file,
            `hl ticket release ${tid}, then hl ticket claim ${tid}`,
          ),
        );
      } else if (stage !== undefined) {
        const def = o.stages();
        if (def.length && stage === def[def.length - 1])
          out.push(warn("claim-on-done", `${tid} is ${stage} but still claimed by ${by}`, file, `hl ticket release ${tid}`));
      }
    }
    if (full) out.push(...zodFindings(TicketToml, raw, "ticket-schema", file));
    return { findings: out, stage, size: str(t.size) };
  }

  // ---------- records ----------
  function checkRecord(tid: string, folder: string, name: string, src: string, file: string, full: boolean): Finding[] {
    const spec = RECORD_DIRS[folder];
    if (!spec || !name.endsWith(".toml")) return [];
    let raw: Raw;
    try {
      raw = parse(src) as Raw;
    } catch (e) {
      return [err("record-parse", `${file} does not parse: ${(e as Error).message.split("\n")[0]}`, file)];
    }
    const out: Finding[] = [];
    const stem = name.slice(0, -".toml".length);
    const id = str(raw.id);
    if (!id || !RECORD_ID.test(id)) out.push(err("record-id", `id ${JSON.stringify(id ?? null)} is not a record id (${spec.prefix}-003-sa)`, file));
    else if (id !== stem) out.push(err("record-id", `id ${id} does not match its file name ${name}`, file, `rename the file to ${id}.toml or fix the id`));
    else if (!id.startsWith(`${spec.prefix}-`)) out.push(err("record-id", `${id} is not a ${spec.kind} id; ${folder}/ holds ${spec.prefix}- ids`, file));
    if (str(raw.ticket) !== tid) out.push(err("record-ticket", `ticket = ${JSON.stringify(raw.ticket ?? null)} but the record lives in ${tid}`, file));
    if (full) out.push(...zodFindings(spec.schema, raw, "record-schema", file));
    return out;
  }

  // ---------- tasks.toml and the AC trace ----------
  interface TaskLite {
    id: string;
    layer?: string;
    acs: string[];
  }
  function checkTasks(tid: string, src: string, file: string, full: boolean): { findings: Finding[]; tasks?: TaskLite[] } {
    let raw: Raw;
    try {
      raw = parse(src) as Raw;
    } catch (e) {
      return { findings: [err("tasks-parse", `${file} does not parse: ${(e as Error).message.split("\n")[0]}`, file)] };
    }
    const out: Finding[] = [];
    if (raw.ticket !== undefined && raw.ticket !== tid)
      out.push(err("tasks-ticket", `ticket = ${JSON.stringify(raw.ticket)} but the file lives in ${tid}`, file));
    const list = Array.isArray(raw.task) ? (raw.task as unknown[]) : [];
    const seen = new Set<string>();
    const tasks: TaskLite[] = [];
    for (const item of list) {
      const t = obj(item) ?? {};
      const id = str(t.id) ?? "";
      if (!TASK_ID.test(id)) out.push(err("task-id", `task id ${JSON.stringify(id)} is not S1-T1 style`, file));
      if (seen.has(id)) out.push(err("task-id", `task id ${id} appears twice`, file));
      seen.add(id);
      tasks.push({ id, layer: str(t.layer), acs: Array.isArray(t.acs) ? t.acs.filter((a): a is string => typeof a === "string") : [] });
    }
    if (full) out.push(...zodFindings(TasksToml, raw, "tasks-schema", file));
    return { findings: out, tasks };
  }

  async function testCaseText(dirRel: string): Promise<string | undefined> {
    const tc = `${dirRel}/test-cases`;
    const md = (await entries(abs(tc))).filter((e) => e.isFile() && e.name.endsWith(".md"));
    if (!md.length) return undefined;
    return (await Promise.all(md.map((e) => text(abs(`${tc}/${e.name}`))))).join("\n");
  }

  async function trace(tid: string, dirRel: string, stage: string | undefined, tasks: TaskLite[] | undefined, specSrc: string | undefined): Promise<Finding[]> {
    if (specSrc === undefined) return [];
    const specFile = `${dirRel}/${tid}-spec.md`;
    const tasksRel = `${dirRel}/tasks.toml`;
    const acs = new Set(specSrc.match(AC_RE) ?? []);
    const out: Finding[] = [];
    const list = tasks ?? [];
    const covered = new Set(list.flatMap((t) => t.acs));
    for (const t of list) {
      for (const a of t.acs) if (!acs.has(a)) out.push(err("task-unknown-ac", `task ${t.id} cites ${a}, which ${tid}-spec.md does not define`, tasksRel));
      if (!t.acs.length && t.layer !== "spike") out.push(warn("task-no-ac", `task ${t.id} cites no acceptance criterion`, tasksRel));
    }
    const si = stageIndex(stage);
    const sorted = [...acs].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    if (si >= buildIndex()) {
      for (const a of sorted)
        if (!covered.has(a))
          out.push(err("ac-no-task", `${a} has no task, and ${tid} is in ${stage}`, specFile, `hl task add ${tid} "<title>" --ac ${a} --layer api`));
    }
    const cases = await testCaseText(dirRel);
    if (cases !== undefined || si >= verifyIndex()) {
      const tested = new Set((cases ?? "").match(AC_RE) ?? []);
      for (const a of sorted) if (!tested.has(a)) out.push(warn("ac-no-test", `${a} has no test case in test-cases/`, specFile));
    }
    return out;
  }

  // ---------- entry points ----------
  async function ticket(tid: string): Promise<Finding[]> {
    const dirRel = `${ARTIFACTS}/${tid}`;
    const out: Finding[] = [];
    const tk = checkTicket(tid, await text(abs(`${dirRel}/ticket.toml`)), `${dirRel}/ticket.toml`, true);
    out.push(...tk.findings);
    await walkLayout(tid, dirRel, "", o.layout.root, out);
    for (const folder of Object.keys(RECORD_DIRS)) {
      for (const e of await entries(abs(`${dirRel}/${folder}`))) {
        if (!e.isFile()) continue;
        const file = `${dirRel}/${folder}/${e.name}`;
        out.push(...checkRecord(tid, folder, e.name, (await text(abs(file))) ?? "", file, true));
      }
    }
    const tasksSrc = await text(abs(`${dirRel}/tasks.toml`));
    let tasks: TaskLite[] | undefined;
    if (tasksSrc !== undefined) {
      const r = checkTasks(tid, tasksSrc, `${dirRel}/tasks.toml`, true);
      out.push(...r.findings);
      tasks = r.tasks;
    }
    out.push(...(await trace(tid, dirRel, tk.stage, tasks, await text(abs(`${dirRel}/${tid}-spec.md`)))));
    return out;
  }

  async function all(): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const e of await entries(abs(ARTIFACTS))) {
      if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
      out.push(...(await ticket(e.name)));
    }
    return out;
  }

  /** Only the checks for this one file. */
  async function file(path: string): Promise<Finding[]> {
    const rel = relOf(path);
    const m = /^artifacts\/([^/]+)\/(.+)$/.exec(rel);
    if (!m) return [];
    const tid = m[1]!;
    const inner = m[2]!;
    const dirRel = `${ARTIFACTS}/${tid}`;
    const src = await text(abs(rel));
    if (src === undefined) return []; // deleted, or a folder
    const out = layoutEntry(tid, inner, rel);
    const parts = inner.split("/");
    if (inner === "ticket.toml") {
      out.push(...checkTicket(tid, src, rel, false).findings);
    } else if (parts.length === 2 && RECORD_DIRS[parts[0]!]) {
      out.push(...checkRecord(tid, parts[0]!, parts[1]!, src, rel, false));
    } else if (inner === "tasks.toml" || inner === `${tid}-spec.md`) {
      const tkSrc = await text(abs(`${dirRel}/ticket.toml`));
      let stage: string | undefined;
      try {
        stage = str(obj((tkSrc ? parse(tkSrc) : {}).ticket)?.stage);
      } catch {
        stage = undefined;
      }
      const tasksSrc = inner === "tasks.toml" ? src : await text(abs(`${dirRel}/tasks.toml`));
      let tasks: TaskLite[] | undefined;
      if (tasksSrc !== undefined) {
        const r = checkTasks(tid, tasksSrc, `${dirRel}/tasks.toml`, false);
        if (inner === "tasks.toml") out.push(...r.findings);
        tasks = r.tasks;
      }
      const specSrc = inner === "tasks.toml" ? await text(abs(`${dirRel}/${tid}-spec.md`)) : src;
      out.push(...(await trace(tid, dirRel, stage, tasks, specSrc)));
    }
    return out;
  }

  return { ticket, all, file };
}
