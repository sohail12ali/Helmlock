// Permission card (F84, F5d): allow once, allow for this chat (or run), deny. Fails closed: when the countdown
// reaches zero the server denies, and the buttons go away here.
import type { ApprovalCard as Card } from "@helmlock/core/contracts";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { useAnswerApproval, useNow } from "@/api/m4";
import { Mono, StatusChip } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function who(c: Card): string {
  const a = c.actor;
  if (!a) return "";
  return a.kind === "agent" ? `${a.id} for ${a.onBehalfOf}` : a.id;
}

const DONE_LABEL: Record<Card["status"], string> = { pending: "pending", allowed: "allowed", denied: "denied", expired: "expired" };

export function ApprovalCard({ card, className, showSource = true }: { card: Card; className?: string; showSource?: boolean }) {
  const now = useNow(1000);
  const answer = useAnswerApproval();
  const [result, setResult] = useState<Card>();
  const c = result ?? card;
  const left = new Date(c.expires).getTime() - now;
  const expired = Number.isFinite(left) && left <= 0;
  const open = c.status === "pending" && !expired;
  const scopeLabel = c.chat_id ? "Allow for this chat" : "Allow for this run";

  const send = (decision: "allow" | "deny", scope?: "once" | "chat") =>
    answer.mutate({ id: c.id, answer: scope ? { decision, scope } : { decision } }, { onSuccess: (r) => r && setResult(r) });

  return (
    <section
      aria-label={`Approval ${c.id}`}
      data-approval={c.id}
      className={cn("flex flex-col gap-2 rounded-lg border border-warn/50 bg-warn/5 p-3 text-sm", !open && "border-border bg-card opacity-80", className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldAlert className="size-4 shrink-0 text-warn" aria-hidden />
        <span className="font-medium">{c.tool ? <Mono>{c.tool}</Mono> : c.action}</span>
        {c.tool && c.action && <span className="text-ink2">{c.action}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {open ? (
            <Mono className="text-xs text-warn" title="Denied automatically when this reaches zero" aria-label="Time left">
              {fmtCountdown(left)}
            </Mono>
          ) : (
            <StatusChip
              status={c.status === "allowed" ? "succeeded" : c.status === "denied" ? "failed" : "no-op"}
              label={expired && c.status === "pending" ? "expired" : DONE_LABEL[c.status]}
            />
          )}
        </span>
      </div>
      {c.input_preview && (
        <pre className="max-h-32 overflow-auto rounded-md bg-sunk p-2 font-mono text-xs whitespace-pre-wrap break-all">{c.input_preview}</pre>
      )}
      {c.detail && <p className="text-ink2">{c.detail}</p>}
      {showSource && (
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {who(c) && <span>Asked by {who(c)}</span>}
          {c.run_id && (
            <Link className="font-mono text-primary hover:underline" to={`/runs/${encodeURIComponent(c.run_id)}`}>
              run {c.run_id}
            </Link>
          )}
          {c.chat_id && (
            <Link className="font-mono text-primary hover:underline" to={`/chat?c=${encodeURIComponent(c.chat_id)}`}>
              chat {c.chat_id}
            </Link>
          )}
        </p>
      )}
      {c.local_only && <p className="text-xs text-muted-foreground">Local only: this can be answered in the console, never from Telegram.</p>}
      {open && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={answer.isPending} onClick={() => send("allow", "once")}>
            Allow once
          </Button>
          <Button size="sm" variant="outline" disabled={answer.isPending} onClick={() => send("allow", "chat")}>
            {scopeLabel}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={answer.isPending} onClick={() => send("deny")}>
            Deny
          </Button>
        </div>
      )}
      {!open && c.decided_by && (
        <p className="text-xs text-muted-foreground">
          {DONE_LABEL[c.status]} by {c.decided_by}
          {c.decided_via ? ` via ${c.decided_via}` : ""}
          {c.scope === "chat" ? ` (${c.chat_id ? "for this chat" : "for this run"})` : ""}
        </p>
      )}
      {answer.isError && (
        <p role="alert" className="text-xs text-destructive">
          {answer.error instanceof ApiError ? answer.error.message : "Could not send the answer."}
          {answer.error instanceof ApiError && <Mono className="ml-1.5">{answer.error.rule}</Mono>}
        </p>
      )}
    </section>
  );
}
