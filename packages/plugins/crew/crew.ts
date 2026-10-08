// The crew service (Blueprint 33, F152-F157): roles and their engines, the next step of a ticket, hand-offs with a
// brief (full for a fresh session, the delta for a resumed one) and the ticket composer (steer, queue, @role, comment).
// Runs are started through the run manager; it owns sessions, worktrees and the concurrency cap.
import type {
  Actor,
  CommentLine,
  Context,
  CrewService,
  EngineCapabilities,
  EngineId,
  EngineTest,
  HandoffInput,
  RunOutcome,
  RunState,
  SayAction,
  StageDef,
  Ticket,
} from "@helmlock/core";
import { ticketText } from "../context/index.ts";
import { agentPack, type CrewConfig, type CrewRoleFull, composeRoles, FALLBACK_ENGINE, liveConfig, STAGE_ACTIONS, stageRoles } from "./config.ts";
import { CrewError, projectRepoDir } from "./project-dir.ts";

/** How long an engine test result is reused. */
export const ENGINE_TEST_TTL_MS = 60_000;

const NO_CAPS: EngineCapabilities = { resume: false, steer: false, approve: false, models: false };

export interface EngineEntry {
  id: EngineId;
  label: string;
  capabilities: EngineCapabilities;
  test: EngineTest;
}

export interface NextStepData {
  role: string;
  label: string;
  engine: EngineId;
  model?: string;
  reason: string;
}

/** Extras the server passes that the contract does not carry (e.g. HL_SERVER_URL and HL_HOOK_TOKEN for approvals). */
export interface RunExtras {
  env?: Record<string, string>;
}

/** The crew service with the non-contract helpers the plugin's verbs and the server use. */
export interface Crew extends CrewService {
  /** Roles with their permission mode. */
  rolesFull(): Promise<CrewRoleFull[]>;
  stageRoles(): Promise<Record<string, string>>;
  /** The runtimes plugin's config as it is now (default_runtime, max_live). */
  runtimesConfig(): Promise<Record<string, unknown>>;
  handoff(input: HandoffInput, actor: Actor, origin?: string, extras?: RunExtras): Promise<RunState>;
  say(ticket: string, text: string, actor: Actor, extras?: RunExtras): Promise<{ action: SayAction; run?: RunState }>;
  /** Forget cached engine tests (after a setting changed). */
  resetEngineCache(): void;
}

export interface CrewOptions {
  ctx: Context;
  /** The config the plugin was mounted with (used when workspace.toml cannot be re-read). */
  mounted?: { crew: Record<string, unknown>; runtimes: Record<string, unknown> };
  now?: () => number;
}

const isLive = (r: RunState) => r.status === "running" || r.status === "queued";
const outcomeOf = (r: RunState): RunOutcome | undefined => (r.outcome && r.outcome !== "none" ? r.outcome : undefined);

/** "@builder take slice 2" -> "builder" when such a role exists. */
export function mentionedRole(text: string, roleIds: readonly string[]): string | undefined {
  for (const m of text.matchAll(/(?:^|[^\w@])@([a-z][a-z0-9-]*)/gi)) {
    const id = (m[1] as string).toLowerCase();
    if (roleIds.includes(id)) return id;
  }
  return undefined;
}

export const REPORT_RULE =
  'When you stop, end with exactly one `hl run report --outcome done|review|blocked|needs-input --summary "..." [--next "..."] [--next-role <role>]`.';

export function createCrew(o: CrewOptions): Crew {
  const { ctx } = o;
  const now = o.now ?? Date.now;
  const mounted = o.mounted ?? { crew: {}, runtimes: {} };
  const testCache = new Map<string, { at: number; test: EngineTest }>();

  const config = async (): Promise<{ crew: CrewConfig; runtimes: Record<string, unknown> }> => liveConfig(ctx.get("files"), mounted);

  const defaultEngine = (runtimes: Record<string, unknown>) =>
    typeof runtimes.default_runtime === "string" && runtimes.default_runtime ? runtimes.default_runtime : FALLBACK_ENGINE;

  async function rolesFull(): Promise<CrewRoleFull[]> {
    const info = ctx.get("workspace");
    const { crew, runtimes } = await config();
    return composeRoles(agentPack(info.root, info.deliveryRoot), crew, defaultEngine(runtimes));
  }

  const manager = () => {
    if (!ctx.has("runManager")) throw new CrewError("no-run-manager", "no plugin provides the run manager", "enable the runtimes plugin in workspace.toml");
    return ctx.get("runManager");
  };

  async function testEngine(id: string): Promise<EngineTest> {
    const hit = testCache.get(id);
    if (hit && now() - hit.at < ENGINE_TEST_TTL_MS) return hit.test;
    const adapter = ctx.has("runtimes") ? ctx.get("runtimes").get(id) : undefined;
    let test: EngineTest;
    if (!adapter) test = { ok: false, checks: [{ level: "error", message: `engine ${id} is not registered` }] };
    else {
      try {
        if (adapter.test) test = await adapter.test();
        else {
          const bin = await adapter.detect();
          test = bin
            ? { ok: true, checks: [{ level: "info", message: `found ${bin.command}${bin.version ? ` ${bin.version}` : ""}` }] }
            : { ok: false, checks: [{ level: "error", message: `${adapter.label ?? id} was not found on this machine` }] };
        }
      } catch (e) {
        test = { ok: false, checks: [{ level: "error", message: `${id} test failed: ${(e as Error).message}` }] };
      }
    }
    testCache.set(id, { at: now(), test });
    return test;
  }

  function stagesOf(): StageDef[] {
    try {
      return ctx.has("workflow") ? ctx.get("workflow").stages() : [];
    } catch {
      return [];
    }
  }

  async function nextFor(t: Ticket): Promise<NextStepData | undefined> {
    const stage = t.ticket.stage;
    const stageDef = stagesOf().find((s) => s.id === stage);
    if (stageDef?.terminal || stage === "done") return undefined;
    const roles = await rolesFull();
    const step = (r: CrewRoleFull, reason: string): NextStepData => ({
      role: r.id,
      label: r.label,
      engine: r.engine,
      ...(r.model ? { model: r.model } : {}),
      reason,
    });
    if (ctx.has("runManager")) {
      const last = (await manager().list({ ticket: t.ticket.id, limit: 20 })).find((r) => !isLive(r));
      const out = last ? outcomeOf(last) : undefined;
      if (out && (out.outcome === "done" || out.outcome === "review") && out.next_role) {
        const r = roles.find((x) => x.id === out.next_role);
        const by = roles.find((x) => x.id === (last?.role ?? last?.agent));
        if (r) return step(r, `${by?.label ?? "The last run"} suggested: ${out.next ?? `hand it to the ${r.label}`}`);
      }
    }
    const roleId = stageRoles((await config()).crew)[stage];
    const r = roleId ? roles.find((x) => x.id === roleId) : undefined;
    if (!r) return undefined;
    return step(r, `Stage ${stage}: ${r.label} ${STAGE_ACTIONS[stage] ?? "takes it"}`);
  }

  async function fullBrief(t: Ticket, role: CrewRoleFull, message: string | undefined, actor: Actor): Promise<string> {
    const id = t.ticket.id;
    const lines = [`You are the ${role.label} on ticket ${id}.`, "", `Ticket: ${t.ticket.title}`, `Stage: ${t.ticket.stage}`];
    if (t.ticket.summary) lines.push(`Summary: ${t.ticket.summary}`);
    if (ctx.has("context")) {
      try {
        lines.push("", `Context (hl context ${id}):`, ticketText(await ctx.get("context").ticket(id)));
      } catch {
        lines.push("", `Read the ticket with \`hl context ${id}\`.`);
      }
    }
    if (message?.trim()) lines.push("", `Message from ${actor.onBehalfOf}: ${message.trim()}`);
    lines.push(
      "",
      "Rules:",
      "- Change ticket state only with hl verbs (hl ticket, hl task, hl question, hl bug ...); never edit state files by hand.",
      `- ${REPORT_RULE}`,
    );
    return lines.join("\n");
  }

  async function deltaBrief(t: Ticket, role: CrewRoleFull, since: string, message: string | undefined, actor: Actor): Promise<string> {
    const id = t.ticket.id;
    const lines = [`Back on ticket ${id} as the ${role.label} (same session). Stage: ${t.ticket.stage}.`];
    const news: { ts: string; text: string }[] = [];
    let comments: CommentLine[] = [];
    try {
      comments = await ctx.get("tickets").comments(id);
    } catch {
      /* no comments file */
    }
    for (const c of comments) if (c.ts > since) news.push({ ts: c.ts, text: `- ${c.author}: ${c.text}` });
    const roles = await rolesFull();
    for (const r of await manager().list({ ticket: id, limit: 50 })) {
      const out = outcomeOf(r);
      const at = r.ended ?? r.started;
      if (!out || at <= since) continue;
      const who = roles.find((x) => x.id === (r.role ?? r.agent))?.label ?? r.role ?? r.agent ?? "a run";
      news.push({ ts: at, text: `- ${who} ended ${out.outcome}: ${out.summary}${out.next ? ` (next: ${out.next})` : ""}` });
    }
    news.sort((a, b) => a.ts.localeCompare(b.ts));
    lines.push("", news.length ? `Since your last run (${since}):` : "Nothing new on the ticket since your last run.", ...news.map((n) => n.text));
    if (message?.trim()) lines.push("", `Message from ${actor.onBehalfOf}: ${message.trim()}`);
    lines.push("", REPORT_RULE);
    return lines.join("\n");
  }

  const crew: Crew = {
    async roles() {
      return (await rolesFull()).map(({ mode: _m, ...r }) => r);
    },
    rolesFull,
    async stageRoles() {
      return stageRoles((await config()).crew);
    },
    async runtimesConfig() {
      return (await config()).runtimes;
    },
    resetEngineCache() {
      testCache.clear();
    },

    async engines() {
      const adapters = ctx.has("runtimes") ? ctx.get("runtimes").list() : [];
      return Promise.all(
        adapters.map(async (a) => ({ id: a.id, label: a.label ?? a.id, capabilities: a.capabilities ?? NO_CAPS, test: await testEngine(a.id) })),
      );
    },

    async next(ticket) {
      return nextFor(await ctx.get("tickets").get(ticket));
    },

    async handoff(input, actor, origin, extras) {
      const t = await ctx.get("tickets").get(input.ticket);
      const roles = await rolesFull();
      let roleId = input.role;
      if (!roleId) {
        const n = await nextFor(t);
        if (!n) throw new CrewError("no-next-role", `${t.ticket.id} has no next step at stage ${t.ticket.stage}`, "name a role: hand it to one explicitly");
        roleId = n.role;
      }
      const role = roles.find((r) => r.id === roleId);
      if (!role) throw new CrewError("unknown-role", `no role ${JSON.stringify(roleId)} in the crew`, `known roles: ${roles.map((r) => r.id).join(", ")}`);
      const engine = input.engine ?? role.engine;
      const model = input.model ?? (input.engine && input.engine !== role.engine ? undefined : role.model);
      const adapter = ctx.has("runtimes") ? ctx.get("runtimes").get(engine) : undefined;
      if (!adapter)
        throw new CrewError(
          "unknown-runtime",
          `engine ${JSON.stringify(engine)} is not registered`,
          `pick another engine: hl crew set ${role.id} --engine <id>`,
        );
      const test = await testEngine(engine);
      if (!test.ok) {
        const why = test.checks.filter((c) => c.level !== "info").map((c) => c.message);
        throw new CrewError(
          "engine-not-ready",
          `${adapter.label ?? engine} is not ready: ${why.join("; ") || "its test failed"}`,
          `fix the engine (install it or sign in), or run the ${role.label} on another one: hl crew set ${role.id} --engine <id>`,
        );
      }

      // cwd: the ticket's project repo folder; a role without a worktree may work in the knowledge repo instead.
      let cwd: string | undefined;
      if (t.ticket.project) {
        try {
          cwd = await projectRepoDir(ctx, t.ticket.project);
        } catch (e) {
          if (role.worktree) throw e;
        }
      }

      const rm = manager();
      const prior = (await rm.list({ ticket: t.ticket.id, role: role.id, limit: 1 }))[0];
      const resumed = !input.fresh && prior !== undefined;
      const prompt = resumed ? await deltaBrief(t, role, prior.ended ?? prior.started, input.message, actor) : await fullBrief(t, role, input.message, actor);
      return rm.start({
        prompt,
        runtime: engine,
        ...(model ? { model } : {}),
        role: role.id,
        agent: role.id,
        ticket: t.ticket.id,
        worktree: role.worktree,
        ...(input.fresh ? { fresh: true } : {}),
        mode: role.mode,
        actor,
        ...(origin ? { origin } : {}),
        ...(cwd ? { cwd } : {}),
        ...(extras?.env ? { env: extras.env } : {}),
      });
    },

    async say(ticket, text, actor, extras) {
      const body = text.trim();
      if (!body) throw new CrewError("bad-request", "say something");
      const t = await ctx.get("tickets").get(ticket);
      const id = t.ticket.id;
      if (ctx.has("runManager")) {
        const rm = manager();
        const runs = await rm.list({ ticket: id, limit: 20 });
        const live = rm.active().find((r) => r.ticket === id && isLive(r)) ?? runs.find(isLive);
        if (live) {
          const delivered = await rm.say(live.id, body, actor.onBehalfOf);
          return { action: delivered === "live" ? "steered" : "queued", run: rm.get(live.id) ?? live };
        }
        const roles = await rolesFull();
        const mention = mentionedRole(
          body,
          roles.map((r) => r.id),
        );
        if (mention) return { action: "handed-off", run: await crew.handoff({ ticket: id, role: mention, message: body }, actor, "console", extras) };
        const last = runs.find((r) => r.role ?? r.agent);
        const lastRole = last ? (last.role ?? last.agent) : undefined;
        if (lastRole && roles.some((r) => r.id === lastRole))
          return { action: "handed-off", run: await crew.handoff({ ticket: id, role: lastRole, message: body }, actor, "console", extras) };
      }
      await ctx.get("tickets").comment(id, body, actor);
      return { action: "commented" };
    },
  };
  return crew;
}
