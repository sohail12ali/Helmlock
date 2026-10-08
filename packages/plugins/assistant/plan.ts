// Assistant routing with plan cards (milestone 8, Blueprint 33; the lc-wms /do ledger as data). The model observes,
// then calls `propose_plan`: the card is stored on an assistant message (`plan`) and the turn ends; the person decides.
// Approved steps become crew hand-offs. Steps on the same ticket run one after the other: the first approved step per
// ticket starts now, the next one starts when that run reports "done" (in this process), or by approving it again
// (the console's Start button) after a restart or a run that ended without "done".
import { randomBytes } from "node:crypto";
import type { Actor, ChatMessageData, CrewService, PlanCard, PlanStep, RunManagerService, RunState, TicketsService } from "@helmlock/core";
import type { ChatStore } from "./store.ts";
import { chatError } from "./store.ts";

export const MAX_PLAN_STEPS = 12;
const TEXT_MAX = 2_000;

export const newPlanId = () => `pl-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;

/** The services the plan code needs; each may be absent (crew is another plugin). */
export interface PlanDeps {
  crew: () => CrewService | undefined;
  tickets: () => TicketsService | undefined;
  runs: () => RunManagerService | undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validates a `propose_plan` call: tickets must exist, roles must be crew roles, an engine must be known. */
export async function buildPlan(input: Record<string, unknown>, deps: PlanDeps): Promise<{ ok: true; card: PlanCard } | { ok: false; error: string }> {
  const crew = deps.crew();
  if (!crew)
    return {
      ok: false,
      error: 'the crew plugin is not enabled in this workspace, so no runs can be started. Tell the person to enable it (plugin id "crew").',
    };
  const title = str(input.title);
  if (!title) return { ok: false, error: "a plan needs a title" };
  if (!Array.isArray(input.steps) || input.steps.length === 0) return { ok: false, error: "a plan needs at least one step" };
  if (input.steps.length > MAX_PLAN_STEPS) return { ok: false, error: `a plan has at most ${MAX_PLAN_STEPS} steps` };
  const roles = await crew.roles();
  const roleIds = new Set(roles.map((r) => r.id));
  let engines: Set<string> | undefined;
  const tickets = deps.tickets();
  const seen = new Map<string, string>();
  const steps: PlanStep[] = [];
  const problems: string[] = [];
  for (const [i, raw] of input.steps.entries()) {
    const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const n = i + 1;
    const ticketIn = str(s.ticket);
    const role = str(s.role);
    const engine = str(s.engine);
    const task = str(s.task).slice(0, TEXT_MAX);
    const done = str(s.done_check).slice(0, TEXT_MAX);
    if (!ticketIn || !role || !task || !done) {
      problems.push(`step ${n}: ticket, role, task and done_check are all required`);
      continue;
    }
    let ticket: string | undefined = seen.get(ticketIn);
    if (!ticket) {
      if (!tickets) {
        problems.push(`step ${n}: tickets cannot be checked (the tickets plugin is not enabled)`);
        continue;
      }
      try {
        const found = (await tickets.get(ticketIn)).id;
        ticket = typeof found === "string" && found ? found : ticketIn;
        seen.set(ticketIn, ticket);
      } catch {
        problems.push(`step ${n}: there is no ticket ${ticketIn} (look it up with ticket_list; never guess ids)`);
        continue;
      }
    }
    if (!roleIds.has(role)) {
      problems.push(`step ${n}: there is no role "${role}"; the roles are ${[...roleIds].join(", ") || "(none)"}`);
      continue;
    }
    if (engine) {
      engines ??= new Set((await crew.engines()).map((e) => e.id));
      if (!engines.has(engine)) {
        problems.push(`step ${n}: there is no engine "${engine}"; the engines are ${[...engines].join(", ") || "(none)"}`);
        continue;
      }
    }
    if (!ticket) continue;
    steps.push({ ticket, role, ...(engine ? { engine } : {}), task, done_check: done, status: "proposed" });
  }
  if (problems.length) return { ok: false, error: `the plan was not shown. ${problems.join("; ")}` };
  return { ok: true, card: { id: newPlanId(), title: title.slice(0, 200), steps, status: "proposed" } };
}

const MARK: Record<PlanStep["status"], string> = { proposed: "◌", approved: "◔", started: "✔", skipped: "⊘", failed: "✗" };

/** A plan card as plain text: the model's view of the card in later turns, and the Telegram fallback. */
export function planText(card: PlanCard): string {
  const lines = [`Plan: ${card.title} (${card.status})`];
  card.steps.forEach((s, i) => {
    const who = s.engine ? `${s.role} on ${s.engine}` : s.role;
    let state: string = s.status;
    if (s.run) state += ` run ${s.run}`;
    if (s.error) state += `: ${s.error}`;
    lines.push(`${MARK[s.status]} ${i + 1}. ${s.ticket} ${who}: ${s.task}`, `   DONE when: ${s.done_check} [${state}]`);
  });
  return lines.join("\n");
}

/** The brief note a hand-off carries. */
export const handoffMessage = (s: PlanStep) => `${s.task}\nDONE when: ${s.done_check}`;

export interface PlanDecisionInput {
  decisions: Record<string, "approve" | "skip">;
  revise?: string;
}

/** Validates the body of POST /chats/:id/plans/:plan. */
export function parseDecision(body: Record<string, unknown>): PlanDecisionInput {
  const d = body.decisions ?? {};
  if (typeof d !== "object" || d === null || Array.isArray(d))
    throw chatError("bad-request", 'decisions must be an object of step index to "approve" or "skip"');
  const decisions: Record<string, "approve" | "skip"> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!/^\d+$/.test(k)) throw chatError("bad-request", `decisions keys are step indexes (0, 1, ...), not "${k}"`);
    if (v !== "approve" && v !== "skip") throw chatError("bad-request", `step ${k}: the decision is "approve" or "skip"`);
    decisions[k] = v;
  }
  const out: PlanDecisionInput = { decisions };
  if (body.revise !== undefined) {
    if (typeof body.revise !== "string") throw chatError("bad-request", "revise must be a string");
    const r = body.revise.trim();
    if (r) out.revise = r.slice(0, TEXT_MAX * 5);
  }
  if (!Object.keys(decisions).length && !out.revise) throw chatError("bad-request", "nothing to decide: give decisions or revise");
  return out;
}

interface Watch {
  chatId: string;
  planId: string;
  actor: Actor;
}

/** Plan decisions and the per-ticket chain. One instance per assistant. */
export function createPlanner(store: ChatStore, deps: PlanDeps) {
  /** Run id -> the card that started it (in memory: a restart leaves later steps "approved" with a Start button). */
  const watching = new Map<string, Watch>();
  const locks = new Map<string, Promise<unknown>>();
  const locked = <T>(chatId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(chatId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(
      chatId,
      next.catch(() => undefined),
    );
    return next;
  };

  const find = async (chatId: string, planId: string) => {
    const chat = await store.load(chatId);
    const msg = chat.messages.find((s) => s.m.plan?.id === planId);
    if (!msg?.m.plan) throw chatError("not-found", `chat ${chatId} has no plan ${planId}`);
    return { chat, stored: msg, card: structuredClone(msg.m.plan) };
  };

  const save = async (chatId: string, stored: { m: ChatMessageData }, card: PlanCard) => {
    card.status = card.steps.some((s) => s.status === "proposed") ? "proposed" : "decided";
    await store.append(chatId, { t: "msg", m: { ...stored.m, plan: card } });
  };

  const live = (runId: string | undefined): boolean => {
    if (!runId) return false;
    const rm = deps.runs();
    if (!rm) return true; // cannot tell: never start a second run on the ticket blindly
    const r: RunState | undefined = rm.get(runId);
    return !!r && (r.status === "running" || r.status === "queued");
  };

  /** Starts the first approved step of every ticket that has no live run from this card. */
  const advance = async (chatId: string, card: PlanCard, actor: Actor, only?: string) => {
    const tickets = [...new Set(card.steps.map((s) => s.ticket))].filter((t) => !only || t === only);
    for (const t of tickets) {
      const mine = card.steps.filter((s) => s.ticket === t);
      if (mine.some((s) => s.status === "started" && live(s.run))) continue;
      const step = mine.find((s) => s.status === "approved");
      if (!step) continue;
      const crew = deps.crew();
      if (!crew) {
        step.status = "failed";
        step.error = "the crew plugin is not enabled in this workspace";
        continue;
      }
      try {
        const run = await crew.handoff(
          { ticket: step.ticket, role: step.role, ...(step.engine ? { engine: step.engine } : {}), message: handoffMessage(step) },
          actor,
          `assistant:${chatId}`,
        );
        step.status = "started";
        step.run = run.id;
        delete step.error;
        watching.set(run.id, { chatId, planId: card.id, actor });
      } catch (e) {
        step.status = "failed";
        step.error = (e as Error).message?.slice(0, 300) || "the hand-off failed";
      }
    }
  };

  return {
    /** Applies a decision; returns the updated card. Revise skips what is still proposed (a new card replaces it). */
    decide(chatId: string, planId: string, d: PlanDecisionInput, actor: Actor): Promise<PlanCard> {
      return locked(chatId, async () => {
        const { stored, card } = await find(chatId, planId);
        for (const [k, v] of Object.entries(d.decisions)) {
          const step = card.steps[Number(k)];
          if (!step) throw chatError("bad-request", `plan ${planId} has no step ${k} (steps are 0 to ${card.steps.length - 1})`);
          if (step.status === "started" || step.status === "skipped") continue; // decided already
          if (v === "skip") {
            step.status = "skipped";
            delete step.error;
          } else step.status = "approved"; // also "Start" for an approved step, and a retry for a failed one
        }
        if (d.revise) for (const s of card.steps) if (s.status === "proposed") s.status = "skipped";
        await advance(chatId, card, actor);
        await save(chatId, stored, card);
        return card;
      });
    },

    /** A run ended: when it reported "done", start the next approved step on its ticket. */
    async runFinished(runId: string): Promise<void> {
      const w = watching.get(runId);
      if (!w) return;
      watching.delete(runId);
      const rm = deps.runs();
      let run = rm?.get(runId);
      if (rm && !run?.outcome) run = (await rm.list({ limit: 50 }).catch(() => [])).find((r) => r.id === runId) ?? run;
      const outcome = run?.outcome;
      if (!outcome || outcome === "none" || outcome.outcome !== "done") return; // the person decides what is next
      await locked(w.chatId, async () => {
        const { stored, card } = await find(w.chatId, w.planId);
        const step = card.steps.find((s) => s.run === runId);
        if (!step) return;
        await advance(w.chatId, card, w.actor, step.ticket);
        await save(w.chatId, stored, card);
      }).catch(() => undefined);
    },

    /** For tests: run ids being watched. */
    watching: () => [...watching.keys()],
  };
}
export type Planner = ReturnType<typeof createPlanner>;
