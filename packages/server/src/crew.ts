// Milestone 8: GET /api/v1/crew (Blueprint 33, mockup 16). The crew roles with their engine test, what each role is
// running or waiting on now, its last run, the live count against the cap, and what needs a person across all runs.
import type { ApiResponse, CrewView, NeedsYouItem, RunState, Runtime } from "@helmlock/core";
import { type Crew, DEFAULT_MAX_LIVE } from "@helmlock/plugins/crew/index.ts";
import type { Hono, Context as HonoContext } from "hono";
import { localDate, type ReadModel } from "./data.ts";
import { ApiError, toErrorBody } from "./errors.ts";

export interface CrewDeps {
  runtime: Runtime;
  ready: () => Promise<ReadModel>;
  log: (line: string) => void;
}

/** Status codes for the rules the crew service throws. */
const STATUS: Record<string, number> = {
  "unknown-role": 422,
  "unknown-runtime": 422,
  "engine-not-ready": 422,
  "no-next-role": 409,
  "unknown-project": 404,
  "no-repo-folder": 422,
  "no-run-manager": 503,
  "no-crew": 503,
  "run-active": 409,
  "bad-request": 400,
  "unknown-run": 404,
  "mode-not-allowed": 403,
};

export function failCrew(c: HonoContext, e: unknown, log: (l: string) => void): Response {
  const rule = (e as { rule?: unknown })?.rule;
  const mapped = !(e instanceof ApiError) && typeof rule === "string" ? STATUS[rule] : undefined;
  const { status, error } = toErrorBody(mapped ? new ApiError(mapped, rule as string, (e as Error).message, { fix: (e as { fix?: string }).fix ?? "" }) : e);
  if (!error.fix) delete error.fix;
  if (status >= 500) log(`${c.req.method} ${c.req.path}: ${(e as Error)?.stack ?? String(e)}`);
  return c.json({ ok: false, error } satisfies ApiResponse<never>, status as 400);
}

export function crewOf(runtime: Runtime): Crew {
  if (!runtime.ctx.has("crew")) throw new ApiError(503, "no-crew", "the crew plugin is not enabled", { fix: 'add [[plugin]] id = "crew" to workspace.toml' });
  return runtime.ctx.get("crew") as Crew;
}

const isLive = (r: RunState) => r.status === "running" || r.status === "queued";

/** Every run known here, newest first: the run manager's list with the in-memory state of live runs on top. */
export async function allRuns(runtime: Runtime, filter: { ticket?: string; limit?: number } = {}): Promise<RunState[]> {
  if (!runtime.ctx.has("runManager")) return [];
  const rm = runtime.ctx.get("runManager");
  const byId = new Map<string, RunState>();
  for (const r of await rm.list(filter)) byId.set(r.id, r);
  for (const r of rm.active()) if (!filter.ticket || r.ticket === filter.ticket) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.started.localeCompare(a.started));
}

export async function crewView(runtime: Runtime, m: ReadModel, today = localDate()): Promise<CrewView> {
  const ctx = runtime.ctx;
  const crew = crewOf(runtime);
  const [roles, engines, runs, rtConfig] = await Promise.all([crew.roles(), crew.engines(), allRuns(runtime, { limit: 200 }), crew.runtimesConfig()]);
  const roleOf = (r: RunState) => r.role ?? r.agent;
  const labelOf = (id: string | undefined) => roles.find((x) => x.id === id)?.label ?? id ?? "A run";

  const view: CrewView["roles"] = roles.map((role) => {
    const eng = engines.find((e) => e.id === role.engine);
    const problem = eng
      ? eng.test.ok
        ? undefined
        : (eng.test.checks.find((c) => c.level === "error") ?? eng.test.checks.find((c) => c.level === "warn"))?.message || "its test failed"
      : `engine ${role.engine} is not registered`;
    const mine = runs.filter((r) => roleOf(r) === role.id);
    const last = mine.find((r) => !isLive(r));
    return {
      ...role,
      engine_ok: problem === undefined,
      ...(problem !== undefined ? { engine_problem: problem } : {}),
      current: mine.filter(isLive),
      ...(last ? { last } : {}),
    };
  });

  // Needs you. The contract's NeedsYouItem kinds have no "approval" or "run outcome" yet: both are questions to a person.
  const needs: NeedsYouItem[] = [];
  if (ctx.has("approvalQueue"))
    for (const a of ctx.get("approvalQueue").pending())
      needs.push({
        kind: "question",
        id: a.id,
        title: `Approve ${a.tool ?? a.action}${a.run_id ? ` (run ${a.run_id})` : ""}`,
        detail: a.input_preview ?? a.detail,
      });
  const latestByTicket = new Map<string, RunState>();
  for (const r of runs) if (r.ticket && !latestByTicket.has(r.ticket)) latestByTicket.set(r.ticket, r);
  for (const r of latestByTicket.values()) {
    const out = r.outcome && r.outcome !== "none" ? r.outcome : undefined;
    if (!out || (out.outcome !== "needs-input" && out.outcome !== "review")) continue;
    needs.push({
      kind: "question",
      ...(r.ticket ? { ticket: r.ticket } : {}),
      id: r.id,
      title: out.outcome === "review" ? `Review the ${labelOf(roleOf(r))}'s work on ${r.ticket}` : `The ${labelOf(roleOf(r))} needs input on ${r.ticket}`,
      detail: out.summary,
    });
  }
  // Open blocking questions: the same items the Overview shows.
  for (const n of (await m.overview(today)).needs_you) if (n.kind === "question") needs.push(n);

  const maxLive = typeof rtConfig.max_live === "number" && rtConfig.max_live > 0 ? rtConfig.max_live : DEFAULT_MAX_LIVE;
  return {
    roles: view,
    engines,
    live: runs.filter((r) => r.status === "running").length,
    max_live: maxLive,
    needs_you: needs,
  };
}

export function registerCrewRoutes(api: Hono, d: CrewDeps): void {
  api.get("/crew", async (c) => {
    try {
      const m = await d.ready();
      return c.json({ ok: true, data: await crewView(d.runtime, m) } satisfies ApiResponse<CrewView>);
    } catch (e) {
      return failCrew(c, e, d.log);
    }
  });
}
