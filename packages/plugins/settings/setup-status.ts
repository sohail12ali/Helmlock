// The first-run step list (Blueprint 34): one list behind GET /api/v1/setup, the console's /welcome wizard, the
// Overview card and `hl setup`, so the three never disagree. Derived from the files on every call.
// Steps: you, engine, code (optional), crew, phone (optional), first-task. Technical upkeep (harness sync, trust) is
// not a step: the wizard repairs it silently (POST /api/v1/setup/upkeep) and reports only failures.
import type { Context, SetupStatus, VerbDef } from "@helmlock/core";
import { ok, secretSource } from "@helmlock/core";
import { z } from "zod";
import type { Crew } from "../crew/crew.ts";
import { readProjects } from "../notes/notes.ts";
import { resolveCommand } from "../runtimes/spawn.ts";
import { readTelegramRow, Config as TelegramConfig } from "../telegram/index.ts";

type Step = SetupStatus["steps"][number];
type Env = Record<string, string | undefined>;

/** Engines that need no binary (the model loop) are usable only through a configured model. */
const MODEL_ENGINES = new Set(["loop"]);
/** Names for the adapters that register no label. */
const LABELS: Record<string, string> = { "claude-code": "Claude Code", cursor: "Cursor", loop: "Helmlock loop" };

/** Engines usable here, id -> label: a CLI found whose (cached, detect-based) test passes, the model loop when it
 *  passes. Without adapters (the CLI mounts them only for `run`), the binaries are looked up on PATH. */
export async function usableEngines(ctx: Context, env: Env = process.env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const adapters = ctx.has("runtimes") ? ctx.get("runtimes").list() : [];
  if (adapters.length) {
    if (ctx.has("crew")) {
      for (const e of await (ctx.get("crew") as Crew).engines()) if (e.test.ok) out.set(e.id, e.label === e.id ? (LABELS[e.id] ?? e.id) : e.label);
    } else for (const a of adapters) if (!MODEL_ENGINES.has(a.id) && (await a.detect().catch(() => null))) out.set(a.id, a.label ?? LABELS[a.id] ?? a.id);
    return out;
  }
  if (await resolveCommand("claude", env)) out.set("claude-code", "Claude Code");
  if ((await resolveCommand("cursor-agent", env)) ?? (await resolveCommand("agent", env))) out.set("cursor", "Cursor");
  if (ctx.has("providers") && ctx.get("providers").models().length) out.set("loop", "Helmlock loop");
  return out;
}

export async function setupStatus(ctx: Context, o: { env?: Env } = {}): Promise<SetupStatus> {
  const info = ctx.get("workspace");
  const env = o.env ?? process.env;
  const steps: Step[] = [];

  // 1. you
  const person = info.author && ctx.has("roster") ? await ctx.get("roster").get(info.author) : undefined;
  steps.push({
    id: "you",
    label: "You",
    done: Boolean(person),
    detail: person
      ? `${person.name} (${person.id})`
      : info.author
        ? `author.local says ${info.author}, who is not in people.toml`
        : "nobody is set as the author on this machine",
    ...(person ? {} : { action: "confirm who you are in the console (/welcome), or add yourself with hl people add and write author.local" }),
  });

  // 2. engine: a CLI that is found and passes its test, or a configured model
  const models = ctx.has("providers") ? ctx.get("providers").models() : [];
  const usable = await usableEngines(ctx, env).catch(() => new Map<string, string>());
  const clis = [...usable].filter(([id]) => !MODEL_ENGINES.has(id)).map(([, label]) => label);
  const engineDone = clis.length > 0 || models.length > 0;
  const parts = [clis.length ? clis.join(", ") : "", models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  steps.push({
    id: "engine",
    label: "Engines",
    done: engineDone,
    detail: engineDone ? parts.join("; ") : "no agent CLI found and no model configured",
    ...(engineDone ? {} : { action: "install Claude Code or the Cursor CLI, or add a model provider (console /welcome, or hl provider add)" }),
  });

  // 3. code (optional)
  const projects = await readProjects(ctx);
  steps.push({
    id: "code",
    label: "Your code",
    done: projects.length > 0,
    optional: true,
    detail: projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"}: ${projects.map((p) => p.id).join(", ")}` : "no projects yet",
    ...(projects.length ? {} : { action: "add a repo folder or import a .code-workspace file (hl project add)" }),
  });

  // 4. crew: every role runs on a registered engine that passes its test
  if (ctx.has("crew")) {
    const crew = ctx.get("crew") as Crew;
    const roles = await crew.roles();
    const bad = roles.filter((r) => !usable.has(r.engine));
    const crewDone = roles.length > 0 && bad.length === 0 && engineDone;
    steps.push({
      id: "crew",
      label: "Your crew",
      done: crewDone,
      detail: !roles.length
        ? "no roles in the agent pack"
        : bad.length
          ? `not ready: ${bad.map((r) => `${r.id} (${r.engine})`).join(", ")}`
          : `${roles.length} roles: ${[...new Set(roles.map((r) => r.engine))].join(", ")}`,
      ...(crewDone ? {} : { action: "pick an engine per role (hl crew set <role> --engine <engine>)" }),
    });
  } else steps.push({ id: "crew", label: "Your crew", done: false, detail: "the crew plugin is not enabled", action: 'add [[plugin]] id = "crew"' });

  // 5. phone (optional): Telegram token by name and at least one allowed id; read fresh
  const tgRow = await readTelegramRow(ctx);
  const tgParsed = TelegramConfig.safeParse(tgRow?.config ?? {});
  const tokenEnv = tgParsed.success ? tgParsed.data.token_env : "HL_TELEGRAM_TOKEN";
  const allowed = tgParsed.success ? tgParsed.data.allowed_user_ids : [];
  const source = secretSource(info.root, env, tokenEnv);
  const tgDone = Boolean(tgRow) && source !== undefined && allowed.length > 0;
  const where = source === ".env" ? "this machine's .env" : "environment";
  steps.push({
    id: "phone",
    label: "Phone",
    done: tgDone,
    optional: true,
    detail: !tgRow
      ? "the telegram plugin is not enabled"
      : !source
        ? `optional: paste the token below or set ${tokenEnv}${allowed.length ? "" : ", then allow your Telegram user id"}`
        : allowed.length
          ? `token in ${tokenEnv} (${where}); ${allowed.length} allowed id${allowed.length === 1 ? "" : "s"}`
          : `token in ${tokenEnv} (${where}); allow at least one Telegram user id`,
    ...(tgDone ? {} : { action: "Settings > Telegram" }),
  });

  // 6. first task
  const count = (await ctx.get("tickets").list()).length;
  steps.push({
    id: "first-task",
    label: "First task",
    done: count > 0,
    detail: count ? `${count} ticket${count === 1 ? "" : "s"}` : "no tickets yet",
    ...(count ? {} : { action: "describe one piece of work (console /welcome, or hl ticket new)" }),
  });
  return { steps };
}

/** "[x] You: Ann Lee (ann)" lines, open required steps marked, optional ones labelled. */
export function setupText(s: SetupStatus): string {
  const lines = s.steps.map((x) => {
    const mark = x.done ? "[x]" : x.optional ? "[ ]" : "[!]";
    const head = `${mark} ${x.label}${x.optional ? " (optional)" : ""}: ${x.detail}`;
    return x.done || !x.action ? head : `${head}\n      ${x.action}`;
  });
  const left = s.steps.filter((x) => !x.done && !x.optional).length;
  lines.push("", left ? `${left} step${left === 1 ? "" : "s"} left; the console walks you through them at /welcome` : "setup is complete");
  return lines.join("\n");
}

/** `hl setup`: the same step list as the console, read-only. */
export const setupVerb: VerbDef = {
  id: "setup",
  summary: "Show the first-run steps (you, engines, code, crew, phone, first task) and what is left; read-only.",
  examples: ["hl setup", "hl setup --json"],
  input: z.object({}),
  writes: false,
  async run(v) {
    const s = await setupStatus(v.ctx);
    return ok(s, setupText(s));
  },
};
