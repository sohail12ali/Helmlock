// The approval gate (F5d, F14): ACT/ASK, fail-closed.
// Order: guards on "approval/request" (any deny wins, nothing can undo it) -> the "approval/request" hook
// (a plugin may decide) -> policy: "act" allows, "ask" asks a person in a TTY -> anything else denies.
// Core has no prompt library; the CLI injects `ask` (a @clack/prompts confirm with a timeout).
import type { Context } from "../contracts/kernel.ts";
import type { ApprovalRequest, ApprovalsService } from "../contracts/services.ts";

/** Ask a person; resolve true for yes, false for no, undefined for no answer (cancel or timeout). */
export type AskFn = (message: string, timeoutMs: number) => Promise<boolean | undefined>;

export const ASK_TIMEOUT_MS = 5 * 60 * 1000;

export interface ApprovalsOptions {
  ctx: Context;
  /** True only when stdin and stdout are a terminal. */
  interactive?: boolean;
  ask?: AskFn;
  /** Per action ("git push", "shell"): "act" runs without asking; default "ask". */
  policy?: Record<string, "act" | "ask">;
  timeoutMs?: number;
}

export function createApprovals(o: ApprovalsOptions): ApprovalsService {
  return {
    async decide(req: ApprovalRequest) {
      const deny = (reason: string) => ({ decision: "deny" as const, reason });
      try {
        const payload = { action: req.action, detail: req.detail, actor: req.actor };
        const denies = await o.ctx.checkGuards("approval/request", payload);
        if (denies.length) return deny(denies.join("; "));
        const hooked = await o.ctx.runHook("approval/request", payload);
        if (hooked.decision === "allow") return { decision: "allow" as const, reason: hooked.reason ?? "allowed by a plugin" };
        if (hooked.decision === "deny") return deny(hooked.reason ?? "denied by a plugin");
        if ((o.policy?.[req.action] ?? "ask") === "act") return { decision: "allow" as const, reason: `policy: act on ${req.action}` };
        if (!o.interactive || !o.ask) return deny(`${req.action} needs approval and no person can answer here (not a terminal); fail-closed`);
        const timeout = o.timeoutMs ?? ASK_TIMEOUT_MS;
        const who = req.actor.kind === "agent" ? `${req.actor.id} (for ${req.actor.onBehalfOf})` : req.actor.id;
        const answer = await o.ask(`Allow ${who} to ${req.action}?${req.detail ? `\n${req.detail}` : ""}`, timeout);
        if (answer === true) return { decision: "allow" as const, reason: "approved by a person" };
        if (answer === false) return deny("declined by a person");
        return deny(`no answer within ${Math.round(timeout / 1000)} s; fail-closed`);
      } catch (e) {
        return deny(`approval failed: ${(e as Error).message}; fail-closed`);
      }
    },
  };
}
