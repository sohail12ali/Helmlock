// One run: live transcript (text, collapsed thinking, tool lines, usage, result), approvals for it, and the kill
// switch with an in-page confirmation (F65). Auto-scroll pauses while the reader is scrolled up.
import type { RunDetail, RunSummary } from "@helmlock/core/contracts";
import { ArrowDown, ArrowLeft, Brain, CheckCircle2, CircleDashed, OctagonX, Wrench, XCircle } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "@/api/client";
import { useRuns } from "@/api/hooks";
import { useCancelRun, useNow, useRunDetail, useRunStream } from "@/api/m4";
import { ErrorState, Mono, StatusChip, TicketLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingApprovals } from "@/features/approvals/PendingApprovals";
import { AttachRun } from "@/features/people/AttachRun";
import { fmtCost, fmtDateTime, fmtDuration, fmtTime, fmtTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { needsRecovery, previewInput, silentFor, type TranscriptItem, toTranscript } from "./run-flags";

type View = {
  id: string;
  runtime: string;
  agent?: string;
  ticket?: string;
  mode: string;
  status: RunDetail["status"];
  started: string;
  ended?: string;
  first_result_line?: string;
  failure_class?: string;
  usage?: RunDetail["usage"];
};

function fromSummary(r: RunSummary): View {
  const status: View["status"] = !r.ended ? "running" : r.failure_class === "cancelled" ? "cancelled" : r.ok === false ? "failed" : "done";
  return { ...r, status };
}

const STATUS_TONE: Record<View["status"], string> = { running: "running", done: "succeeded", failed: "failed", cancelled: "no-op" };

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "text":
      return <p className="whitespace-pre-wrap break-words">{item.text}</p>;
    case "thinking":
      return (
        <details className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1.5">
            <Brain className="size-3.5" /> Thinking
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
        </details>
      );
    case "tool":
      return (
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink2" data-tool={item.name}>
          {!item.done ? (
            <CircleDashed className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-label="running" />
          ) : item.isError ? (
            <XCircle className="size-3.5 shrink-0 text-destructive" aria-label="failed" />
          ) : (
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-label="done" />
          )}
          <span className="font-semibold">{item.name}</span>
          <span className="min-w-0 truncate text-muted-foreground">{previewInput(item.input)}</span>
        </div>
      );
    case "usage":
      return (
        <p className="font-mono text-xs text-muted-foreground">
          usage {fmtTokens(item.event.inputTokens)} in / {fmtTokens(item.event.outputTokens)} out
          {item.event.cacheReadTokens ? ` · ${fmtTokens(item.event.cacheReadTokens)} cached` : ""}
          {item.event.costUsd != null ? ` · ${fmtCost(item.event.costUsd)}` : ""}
        </p>
      );
    case "result":
      return (
        <div
          className={cn("flex items-start gap-2 rounded-md border p-2", item.ok ? "border-ok/40 bg-ok/5" : "border-destructive/40 bg-destructive/5")}
          data-testid="run-result"
        >
          {item.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <div className="min-w-0">
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
            {item.failureClass && <Mono className="text-xs text-destructive">{item.failureClass}</Mono>}
          </div>
        </div>
      );
    case "stderr":
      return <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-warn">{item.text}</pre>;
    case "init":
      return <p className="font-mono text-xs text-muted-foreground">session started{item.model ? ` · ${item.model}` : ""}</p>;
  }
}

function CancelButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelRun(id);
  if (!confirming)
    return (
      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
        <OctagonX /> Cancel run
      </Button>
    );
  return (
    <div
      role="alertdialog"
      aria-label="Confirm cancel"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm"
    >
      <span>Stop this run and its child processes?</span>
      <Button
        size="sm"
        className="bg-destructive text-white"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      >
        {cancel.isPending ? "Stopping" : "Stop run"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep running
      </Button>
      {cancel.isError && (
        <span role="alert" className="w-full text-xs text-destructive">
          {cancel.error instanceof ApiError ? cancel.error.message : "Could not cancel."}
        </span>
      )}
    </div>
  );
}

export function RunView() {
  const { id = "" } = useParams();
  const detail = useRunDetail(id);
  const runs = useRuns();
  const summary = runs.data?.find((r) => r.id === id);
  const { lines, state } = useRunStream(id);
  const items = useMemo(() => toTranscript(lines), [lines]);
  const now = useNow(30_000);

  const view: View | undefined = detail.data ?? (summary ? fromSummary(summary) : undefined);
  const running = view?.status === "running" && state !== "ended";
  const lastTs = lines.length ? new Date(lines[lines.length - 1]!.ts).getTime() : view ? new Date(view.started).getTime() : undefined;
  const silent = running ? silentFor(lastTs, now) : 0;
  // Usage folded from the stream while running; the run record wins when present.
  const streamUsage = useMemo(() => {
    let inT = 0;
    let outT = 0;
    let cost: number | null = null;
    for (const l of lines)
      if (l.event.type === "usage") {
        inT += l.event.inputTokens;
        outT += l.event.outputTokens;
        if (l.event.costUsd != null) cost = (cost ?? 0) + l.event.costUsd;
      }
    return inT || outT ? { input_tokens: inT, output_tokens: outT, cost_usd: cost } : undefined;
  }, [lines]);
  const usage = view?.usage ?? streamUsage;

  // Auto-scroll: follow the bottom unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new items arrive
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [items.length, items[items.length - 1]]);

  const notFound = detail.isError && !summary && !runs.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b bg-card p-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/agents" aria-label="Back to runs">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="font-mono text-base font-semibold">{id}</h1>
          {view && (
            <StatusChip
              status={STATUS_TONE[view.status]}
              label={view.status === "failed" && view.failure_class ? `failed: ${view.failure_class}` : view.status}
            />
          )}
          {view && needsRecovery({ ended: view.ended, ok: view.status === "failed" ? false : undefined, failure_class: view.failure_class }) && (
            <Badge variant="danger">Recovery needed</Badge>
          )}
          {silent > 0 && (
            <Badge variant="warn" title="No output from the run for this long (F65)">
              silent {silent} m
            </Badge>
          )}
          <span className="ml-auto">{running && <CancelButton id={id} />}</span>
          {view && !running && <AttachRun key={id} runId={id} defaultTicket={view.ticket} />}
        </div>
        {view && (
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              <dt className="sr-only">Agent</dt>
              <dd>
                <Badge variant="outline">{view.agent ?? "no agent"}</Badge>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Runtime</dt>
              <dd className="font-mono">
                {view.runtime}/{view.mode}
              </dd>
            </div>
            {view.ticket && (
              <div>
                <dt className="sr-only">Ticket</dt>
                <dd>
                  <TicketLink id={view.ticket} />
                </dd>
              </div>
            )}
            <div>
              <dt className="sr-only">Started</dt>
              <dd>
                {fmtDateTime(view.started)}
                {view.ended ? ` · ${fmtDuration(view.started, view.ended)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Tokens</dt>
              <dd className="font-mono">
                {usage ? `${fmtTokens(usage.input_tokens)} in / ${fmtTokens(usage.output_tokens)} out` : "-"}
                {usage?.cost_usd != null && ` · ${fmtCost(usage.cost_usd)}`}
              </dd>
            </div>
          </dl>
        )}
        <PendingApprovals runId={id} showSource={false} />
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto p-3 sm:p-4" data-testid="run-transcript" aria-live="polite">
          {notFound && <ErrorState error={detail.error} />}
          {items.length === 0 && !notFound && (
            <p className="text-sm text-muted-foreground">
              {state === "unavailable"
                ? "No live transcript for this run. Runs started from the terminal keep their log in the run record."
                : state === "ended"
                  ? "This run produced no output."
                  : "Waiting for output…"}
            </p>
          )}
          <ol className="flex w-full flex-col gap-2 text-sm">
            {items.map((it) => (
              <li key={`${it.kind}-${it.seq}`}>
                <Item item={it} />
              </li>
            ))}
          </ol>
          {lines.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {state === "ended" ? "ended" : state === "open" ? "live" : state} · last {fmtTime(lines[lines.length - 1]!.ts)}
            </p>
          )}
        </div>
        {!follow && (
          <Button
            size="sm"
            variant="outline"
            className="absolute right-4 bottom-4 shadow-md"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
              setFollow(true);
            }}
          >
            <ArrowDown /> Jump to latest
          </Button>
        )}
      </div>
    </div>
  );
}
