// The ticket thread (mockup 15): comments, runs as timeline cards and outcomes in one stream, oldest first,
// with the Next step bar on top and the composer at the bottom. Works on the ticket page and in the board drawer.
import type { ThreadItem } from "@helmlock/core/contracts";
import { ApiError } from "@/api/client";
import { useTicket } from "@/api/hooks";
import { useCrew, useM8Live, useThread } from "@/api/m8";
import { CommentBox } from "@/components/actions/RecordActions";
import { ErrorState, Loading, Mono } from "@/components/common";
import { RunCard } from "@/features/crew/RunCard";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ThreadComposer } from "./Composer";
import { NextStepBar, roleOnTicket } from "./NextStep";

function Comment({ item }: { item: Extract<ThreadItem, { kind: "comment" }> }) {
  return (
    <div className="rounded-md border bg-card p-3 text-sm" data-comment>
      <div className="mb-1 flex gap-2 text-xs text-muted-foreground">
        <Mono>{item.author}</Mono>
        <span>{fmtDateTime(item.ts)}</span>
        {item.run && <Mono className="text-muted-foreground">{item.run}</Mono>}
      </div>
      <p className="whitespace-pre-wrap">{item.text}</p>
    </div>
  );
}

/** A server without the milestone 8 thread: the comment list and the comment box, as before. */
function LegacyThread({ ticket }: { ticket: string }) {
  const q = useTicket(ticket);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const comments = q.data.comments;
  return (
    <div className="flex flex-col gap-2">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.ts + c.author}>
              <Comment item={{ kind: "comment", ...c }} />
            </li>
          ))}
        </ol>
      )}
      <CommentBox ticket={ticket} />
    </div>
  );
}

export function TicketThreadView({ ticket, showNext = true, className }: { ticket: string; showNext?: boolean; className?: string }) {
  useM8Live();
  const q = useThread(ticket);
  const crew = useCrew();
  const roles = crew.data?.roles ?? [];

  if (q.isPending) return <Loading label="Loading the thread" />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <LegacyThread ticket={ticket} />;
    return <ErrorState error={q.error} />;
  }
  const { items, live } = q.data;
  const onRole = roleOnTicket(items, live) ?? q.data.next?.role;
  // A run's outcome comment is shown by its outcome card; skip the duplicate.
  const withOutcome = new Set(items.flatMap((i) => (i.kind === "run" && i.run.outcome && i.run.outcome !== "none" ? [i.run.id] : [])));
  const shown = items.filter((i) => !(i.kind === "comment" && i.run && withOutcome.has(i.run)));
  const lastRun = [...shown].reverse().find((i) => i.kind === "run");

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="ticket-thread">
      {showNext && <NextStepBar ticket={ticket} lastRole={onRole} />}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet. Use Next step to hand the ticket to the crew, or write below.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Thread">
          {shown.map((it) =>
            it.kind === "comment" ? (
              <li key={`c-${it.ts}-${it.author}`}>
                <Comment item={it} />
              </li>
            ) : (
              <li key={`r-${it.run.id}`}>
                <RunCard run={it.run} defaultOpen={it === lastRun} />
              </li>
            ),
          )}
        </ol>
      )}
      <ThreadComposer ticket={ticket} onRole={onRole} roles={roles} />
    </div>
  );
}
