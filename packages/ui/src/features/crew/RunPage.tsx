// One run on its own page (/runs/:id): the same timeline as the ticket thread, with the side rail in the right panel.
import type { RunState, RunSummary } from "@helmlock/core/contracts";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useRuns } from "@/api/hooks";
import { useApprovals, useNow, useRunDetail } from "@/api/m4";
import { ErrorState, Loading, TicketLink } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { AttachRun } from "@/features/people/AttachRun";
import { needsRecovery, silentFor } from "@/lib/run-flags";
import { isLive, threadPath } from "./bits";
import { RunBody, RunHeader, RunRail, useRunTimeline } from "./RunCard";

function fromSummary(r: RunSummary): RunState {
  const status: RunState["status"] = !r.ended ? "running" : r.failure_class === "cancelled" ? "cancelled" : r.ok === false ? "failed" : "done";
  return {
    id: r.id,
    runtime: r.runtime,
    agent: r.agent,
    ticket: r.ticket,
    mode: r.mode as RunState["mode"],
    status,
    started: r.started,
    ended: r.ended,
    first_result_line: r.first_result_line,
    failure_class: r.failure_class,
    usage: r.usage,
  };
}

export function RunPage() {
  const { id = "" } = useParams();
  const detail = useRunDetail(id);
  const runs = useRuns();
  const summary = runs.data?.find((r) => r.id === id);
  const run = detail.data ?? (summary ? fromSummary(summary) : undefined);
  const { timeline, state, lines } = useRunTimeline(id);
  const approvals = useApprovals("pending");
  const now = useNow(30_000);

  if (!run) {
    if (detail.isPending || runs.isPending) return <Loading />;
    return (
      <div className="p-4">
        <ErrorState error={detail.error} />
      </div>
    );
  }
  const running = isLive(run) && state !== "ended";
  const lastTs = lines.length ? new Date(lines[lines.length - 1]!.ts).getTime() : new Date(run.started).getTime();
  const silent = running && run.status === "running" ? silentFor(lastTs, now) : 0;
  // Approvals of this run that the timeline does not show inline (an engine that sends no approval events).
  const inline = new Set(timeline.rows.flatMap((r) => (r.kind === "approval" ? [r.id] : [])));
  const pending = (approvals.data ?? []).filter((c) => c.status === "pending" && c.run_id === id && !inline.has(c.id));

  return (
    <PageLayout id="run" rightTitle="This run" right={<RunRail run={run} timeline={timeline} />}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to={run.ticket ? threadPath(run.ticket) : "/crew"} aria-label={run.ticket ? "Back to the ticket thread" : "Back to crew"}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-mono text-base font-semibold">{id}</h1>
        {run.ticket && <TicketLink id={run.ticket} />}
        {needsRecovery({ ended: run.ended, ok: run.status === "failed" ? false : undefined, failure_class: run.failure_class }) && (
          <Badge variant="danger">Recovery needed</Badge>
        )}
        {silent > 0 && (
          <Badge variant="warn" title="No output from the run for this long (F65)">
            silent {silent} m
          </Badge>
        )}
        <span className="ml-auto">{!running && <AttachRun key={id} runId={id} defaultTicket={run.ticket} />}</span>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <RunHeader run={run} timeline={timeline} link={false} />
        {pending.length > 0 && (
          <ul aria-label="Pending approvals" className="flex flex-col gap-2">
            {pending.map((c) => (
              <li key={c.id}>
                <ApprovalCard card={c} showSource={false} />
              </li>
            ))}
          </ul>
        )}
        <RunBody run={run} timeline={timeline} state={state} />
      </div>
    </PageLayout>
  );
}
