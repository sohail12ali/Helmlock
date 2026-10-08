// FROZEN CONTRACT (milestone 1). Observe-only events.
import type { Actor } from "./verbs.ts";

export interface Events {
  "ticket.created": { id: string; title: string; actor: Actor };
  "ticket.moved": { id: string; from: string; to: string; actor: Actor };
  "ticket.blocked": { id: string; blocked: boolean; by?: string; next?: string; actor: Actor };
  "record.added": { kind: string; id: string; ticket?: string; actor: Actor };
  "worklog.appended": { author: string; date: string; ticket: string; skipped: boolean };
  "verb.done": { verb: string; code: 0 | 1 | 2; entity?: string; actor: Actor; dryRun: boolean };
  "run.started": { runId: string; runtime: string; ticket?: string };
  "run.finished": { runId: string; runtime: string; ticket?: string; ok: boolean };
  // milestone 4
  "approval.requested": { id: string; action: string; detail: string; runId?: string; chatId?: string; localOnly: boolean };
  "approval.decided": { id: string; decision: "allow" | "deny"; by: string; channel: "console" | "telegram" | "terminal" | "timeout" };
  "chat.message": { chatId: string; role: "user" | "assistant"; text: string; channel: "console" | "telegram" };
  // milestone 7: a machine secret was saved (name only, never the value); e.g. the Telegram bot re-checks its token.
  "secret.saved": { name: string; actor: Actor };
}
