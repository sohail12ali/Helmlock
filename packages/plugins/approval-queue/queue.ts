// The approval queue (F5d, F14, F84): permission cards a person answers in the console (or Telegram), fail-closed.
// A request parks on a promise until answer() or the timeout (deny). "Allow for this chat" remembers the same tool
// for the same run or chat. Local-only cards (clipboard, screenshots) are never answered from Telegram (F4c, F122).
// Shape after control-center console/server/agent_approvals.py (Pending + threading.Event, LOCAL_ONLY, allow-session).
import { randomBytes } from "node:crypto";
import type { ApprovalCardData, ApprovalQueueService, Events } from "@helmlock/core";

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const RECENT_CAP = 200;

/** Actions (or tool names) a person may only approve at this machine. */
export const LOCAL_ONLY = new Set([
  "clipboard",
  "screenshot",
  "console_desktop_screenshot",
  "console_desktop_clipboard_read",
  "mcp__console__desktop-screenshot",
  "mcp__console__desktop-clipboard-read",
]);

export type CardRequest = Omit<ApprovalCardData, "id" | "created" | "expires" | "status">;
type Via = "console" | "telegram" | "terminal";

export class ApprovalError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  constructor(rule: string, message: string, fix?: string) {
    super(message);
    this.rule = rule;
    this.fix = fix;
  }
}

export interface ApprovalLogRow {
  ts: string;
  event: "requested" | "decided";
  card: ApprovalCardData;
}

export interface ApprovalQueueOptions {
  timeoutMs?: number;
  emit?: <E extends keyof Events>(event: E, payload: Events[E]) => Promise<void> | void;
  /** Append-only local log (approvals/YYYY-MM-DD.jsonl); errors are swallowed. */
  log?: (row: ApprovalLogRow) => Promise<void> | void;
  now?: () => Date;
}

export interface ApprovalQueue extends ApprovalQueueService {
  /** True once a console (hl serve) is attached: core approvals.decide() then asks the queue instead of denying. */
  readonly remote: boolean;
  enableRemote(on?: boolean): void;
  /** Deny every pending card of a run that ended (nobody is waiting for them any more). */
  expireRun(runId: string, reason?: string): void;
  /** Deny every pending card (shutdown). */
  close(): void;
}

interface Parked {
  card: ApprovalCardData;
  resolve: (c: ApprovalCardData) => void;
  timer: NodeJS.Timeout;
}

const newId = () => `ap-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

export function createApprovalQueue(o: ApprovalQueueOptions = {}): ApprovalQueue {
  const now = o.now ?? (() => new Date());
  const parked = new Map<string, Parked>();
  const recent: ApprovalCardData[] = [];
  /** scope key ("run:<id>" or "chat:<id>") + "\0" + tool -> who granted it. */
  const allowances = new Map<string, { by: string; via: Via }>();
  let remote = false;

  const log = (event: ApprovalLogRow["event"], card: ApprovalCardData) => {
    try {
      void Promise.resolve(o.log?.({ ts: now().toISOString(), event, card: { ...card } })).catch(() => {});
    } catch {
      /* logging never breaks a decision */
    }
  };
  const emit = <E extends keyof Events>(event: E, payload: Events[E]) => {
    try {
      void Promise.resolve(o.emit?.(event, payload)).catch(() => {});
    } catch {
      /* observe-only */
    }
  };
  const remember = (card: ApprovalCardData) => {
    recent.unshift({ ...card });
    if (recent.length > RECENT_CAP) recent.length = RECENT_CAP;
  };
  const scopeKey = (c: Pick<ApprovalCardData, "run_id" | "chat_id" | "tool" | "action">) => {
    const owner = c.run_id ? `run:${c.run_id}` : c.chat_id ? `chat:${c.chat_id}` : undefined;
    return owner ? `${owner}\0${c.tool ?? c.action}` : undefined;
  };
  const settle = (p: Parked, patch: Partial<ApprovalCardData>) => {
    clearTimeout(p.timer);
    parked.delete(p.card.id);
    Object.assign(p.card, patch);
    remember(p.card);
    log("decided", p.card);
    emit("approval.decided", {
      id: p.card.id,
      decision: p.card.status === "allowed" ? "allow" : "deny",
      by: p.card.decided_by ?? "timeout",
      channel: p.card.decided_via ?? "timeout",
    });
    p.resolve({ ...p.card });
  };

  return {
    get remote() {
      return remote;
    },
    enableRemote(on = true) {
      remote = on;
    },

    request(req: CardRequest, opts?: { timeoutMs?: number }): Promise<ApprovalCardData> {
      const timeoutMs = opts?.timeoutMs ?? o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const created = now();
      const local_only = req.local_only || LOCAL_ONLY.has(req.action) || (req.tool !== undefined && LOCAL_ONLY.has(req.tool));
      const card: ApprovalCardData = {
        ...req,
        local_only,
        id: newId(),
        created: created.toISOString(),
        expires: new Date(created.getTime() + timeoutMs).toISOString(),
        status: "pending",
      };
      const key = local_only ? undefined : scopeKey(card);
      const granted = key ? allowances.get(key) : undefined;
      if (granted) {
        // Allowed earlier "for this chat": no card, but the decision is still logged.
        Object.assign(card, { status: "allowed", decided_by: granted.by, decided_via: granted.via, scope: "chat" });
        remember(card);
        log("decided", card);
        emit("approval.decided", { id: card.id, decision: "allow", by: granted.by, channel: granted.via });
        return Promise.resolve({ ...card });
      }
      return new Promise<ApprovalCardData>((resolve) => {
        const p: Parked = {
          card,
          resolve,
          timer: setTimeout(() => settle(p, { status: "expired", decided_by: "timeout", decided_via: "timeout" }), timeoutMs),
        };
        p.timer.unref?.();
        parked.set(card.id, p);
        log("requested", card);
        emit("approval.requested", {
          id: card.id,
          action: card.action,
          detail: card.detail,
          localOnly: card.local_only,
          ...(card.run_id ? { runId: card.run_id } : {}),
          ...(card.chat_id ? { chatId: card.chat_id } : {}),
        });
      });
    },

    pending() {
      return [...parked.values()].map((p) => ({ ...p.card })).sort((a, b) => a.created.localeCompare(b.created));
    },

    recent(limit = 50) {
      return recent.slice(0, Math.max(0, limit)).map((c) => ({ ...c }));
    },

    answer(id, decision, by, via, scope = "once") {
      const p = parked.get(id);
      if (!p) {
        const done = recent.find((c) => c.id === id);
        if (done) throw new ApprovalError("already-decided", `approval ${id} is already ${done.status}`, "reload the approvals list");
        throw new ApprovalError("unknown-approval", `no approval ${id}`, "list pending approvals with GET /api/v1/approvals");
      }
      if (via === "telegram" && p.card.local_only)
        throw new ApprovalError("local-only", `approval ${id} (${p.card.action}) can only be answered at this machine`, "answer it in the console");
      // "Allow for this chat" never applies to local-only cards: each one is a fresh decision.
      const effective = p.card.local_only ? "once" : scope;
      if (decision === "allow" && effective === "chat") {
        const key = scopeKey(p.card);
        if (key) allowances.set(key, { by, via });
      }
      settle(p, { status: decision === "allow" ? "allowed" : "denied", decided_by: by, decided_via: via, scope: effective });
      return { ...p.card };
    },

    expireRun(runId, reason = "run ended") {
      for (const p of [...parked.values()]) if (p.card.run_id === runId) settle(p, { status: "expired", decided_by: reason, decided_via: "timeout" });
      for (const k of [...allowances.keys()]) if (k.startsWith(`run:${runId}\0`)) allowances.delete(k);
    },

    close() {
      for (const p of [...parked.values()]) settle(p, { status: "expired", decided_by: "shutdown", decided_via: "timeout" });
    },
  };
}
