// Agents and runs (mockup 13, F84, F65, F97): start a run in one line, runs list with active ones first.
import type { RunSummary } from "@helmlock/core/contracts";
import { useNavigate } from "react-router";
import { useBoard, useRuns } from "@/api/hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader, StatusChip, TicketLink } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PendingApprovals } from "@/features/approvals/PendingApprovals";
import { inProject, useActiveProject } from "@/features/projects/active";
import { fmtCost, fmtDateTime, fmtTokens } from "@/lib/format";
import { useListNav } from "@/lib/keys";
import { runState, runTokens } from "@/lib/runs";
import { cn } from "@/lib/utils";
import { needsRecovery, sortRuns } from "./run-flags";
import { StartRunForm } from "./StartRunForm";

export const runPath = (id: string) => `/agents/runs/${encodeURIComponent(id)}`;

export function RunsList({ runs }: { runs: RunSummary[] }) {
  const navigate = useNavigate();
  const [sel, setSel] = useListNav(runs.length, (i) => runs[i] && navigate(runPath(runs[i].id)));
  if (runs.length === 0)
    return (
      <EmptyState title="No agent runs yet." hint="Runs start only when a person or the dispatcher starts one. Describe a task above and press Start run." />
    );
  return (
    <ul className="divide-y" aria-label="Runs">
      {runs.map((r, i) => {
        const state = runState(r);
        const recovery = needsRecovery(r);
        return (
          <li key={r.id} data-nav-index={i}>
            {/* biome-ignore lint/a11y/useSemanticElements: a row with a nested ticket link */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate(runPath(r.id))}
              onKeyDown={(e) => e.key === "Enter" && navigate(runPath(r.id))}
              onMouseEnter={() => setSel(i)}
              className={cn(
                "grid w-full cursor-pointer grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                sel === i && "bg-accent",
              )}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <StatusChip status={state} label={state === "failed" && r.failure_class ? `failed: ${r.failure_class}` : state} />
                <Badge variant="outline" title="trigger / agent">
                  {r.agent ?? r.runtime}
                </Badge>
                <Mono className="text-xs text-ink2">{r.id}</Mono>
                {r.ticket && (
                  // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row click off the ticket link
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <TicketLink id={r.ticket} className="text-xs" />
                  </span>
                )}
                {recovery && <Badge variant="danger">Recovery needed</Badge>}
                {r.failure_class === "stalled" && <Badge variant="warn">silent</Badge>}
              </span>
              <span className="text-right font-mono text-xs text-ink2">
                {fmtTokens(runTokens(r)) || "-"} tok
                {r.usage?.cost_usd != null && <span className="block text-muted-foreground">{fmtCost(r.usage.cost_usd)}</span>}
              </span>
              <span className="col-span-2 flex min-w-0 gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">{fmtDateTime(r.started)}</span>
                <span className="shrink-0 font-mono">
                  {r.runtime}/{r.mode}
                </span>
                <span className="min-w-0 truncate text-ink2">{r.first_result_line ?? (state === "running" ? "working…" : "")}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AgentsPage() {
  const q = useRuns();
  // Active project (milestone 7): runs of other projects' tickets are hidden; runs with no ticket stay.
  const { project } = useActiveProject();
  const board = useBoard();
  const runs = sortRuns(inProject(q.data ?? [], project, (r) => r.ticket, board.data?.tickets));

  const today = new Date().toISOString().slice(0, 10);
  const todays = runs.filter((r) => r.started.startsWith(today));
  const ok = todays.filter((r) => runState(r) === "succeeded").length;
  const noop = todays.filter((r) => runState(r) === "no-op").length;
  const live = runs.filter((r) => runState(r) === "running").length;
  const tokens = todays.reduce((n, r) => n + (runTokens(r) ?? 0), 0);
  const byAgent = new Map<string, number>();
  for (const r of todays) byAgent.set(r.agent ?? r.runtime, (byAgent.get(r.agent ?? r.runtime) ?? 0) + 1);

  return (
    <PageLayout id="agents">
      <PageHeader title="Agents and chat" />
      <StartRunForm />
      <PendingApprovals className="mt-3" />
      <div className="mt-3 mb-3 grid grid-cols-1 gap-3 @xl:grid-cols-3">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Runs today</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{todays.length}</p>
          <p className="text-xs text-muted-foreground">
            {ok} succeeded, {noop} no-op{live ? `, ${live} running` : ""}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Tokens today</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{fmtTokens(tokens) || 0}</p>
          <p className="text-xs text-muted-foreground">{todays.length ? `avg ${fmtTokens(Math.round(tokens / todays.length))} per run` : "no runs today"}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted-foreground">By agent</p>
          <p className="mt-1 truncate font-mono text-sm">{[...byAgent].map(([a, n]) => `${a} ${n}`).join(" · ") || "-"}</p>
        </Card>
      </div>
      <Card className="p-2">{q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} /> : <RunsList runs={runs} />}</Card>
    </PageLayout>
  );
}
