import { useSearchParams } from "react-router";
import { useRuns } from "@/api/hooks";
import { CopyCommand, ErrorState, Loading, Mono, PageHeader, StatusChip, TicketLink } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { RunsTable } from "@/components/RunsTable";
import { Card } from "@/components/ui/card";
import { fmtCost, fmtDateTime, fmtDuration, fmtTokens } from "@/lib/format";
import { useListNav } from "@/lib/keys";
import { runState, runTokens } from "@/lib/runs";

export function AgentsPage() {
  const q = useRuns();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("run") ?? undefined;
  const runs = q.data ?? [];
  const select = (id: string | undefined) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set("run", id);
        else n.delete("run");
        return n;
      },
      { replace: true },
    );
  const [cursor] = useListNav(runs.length, (i) => select(runs[i]?.id));

  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <div className="p-4">
        <ErrorState error={q.error} />
      </div>
    );

  const today = new Date().toISOString().slice(0, 10);
  const todays = runs.filter((r) => r.started.startsWith(today));
  const ok = todays.filter((r) => runState(r) === "succeeded").length;
  const noop = todays.filter((r) => runState(r) === "no-op").length;
  const tokens = todays.reduce((n, r) => n + (runTokens(r) ?? 0), 0);
  const byAgent = new Map<string, number>();
  for (const r of todays) byAgent.set(r.agent ?? r.runtime, (byAgent.get(r.agent ?? r.runtime) ?? 0) + 1);
  const sel = runs.find((r) => r.id === selectedId);

  return (
    <PageLayout
      id="agents"
      rightTitle="Run"
      onCloseRight={() => select(undefined)}
      right={
        sel ? (
          <div className="flex flex-col gap-3 text-sm" data-testid="run-detail">
            <h2 className="font-mono text-base font-semibold">{sel.id}</h2>
            <StatusChip status={runState(sel)} className="self-start" />
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5">
              <dt className="text-muted-foreground">Agent</dt>
              <dd>{sel.agent ?? "-"}</dd>
              <dt className="text-muted-foreground">Runtime</dt>
              <dd>
                <Mono>
                  {sel.runtime}/{sel.mode}
                </Mono>
              </dd>
              <dt className="text-muted-foreground">Ticket</dt>
              <dd>{sel.ticket ? <TicketLink id={sel.ticket} /> : "-"}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{fmtDateTime(sel.started)}</dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{fmtDuration(sel.started, sel.ended) || "running"}</dd>
              <dt className="text-muted-foreground">Tokens</dt>
              <dd>
                <Mono>
                  {sel.usage ? `${fmtTokens(sel.usage.input_tokens)} in / ${fmtTokens(sel.usage.output_tokens)} out` : "-"}
                  {sel.usage?.cost_usd != null && ` · ${fmtCost(sel.usage.cost_usd)}`}
                </Mono>
              </dd>
              {sel.failure_class && (
                <>
                  <dt className="text-muted-foreground">Failure</dt>
                  <dd className="text-destructive">{sel.failure_class}</dd>
                </>
              )}
            </dl>
            {sel.first_result_line && <p className="rounded-md bg-sunk p-2 text-ink2">{sel.first_result_line}</p>}
          </div>
        ) : undefined
      }
    >
      <PageHeader title="Agents and chat" />
      <div className="mb-3 grid grid-cols-1 gap-3 @xl:grid-cols-3">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Runs today</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{todays.length}</p>
          <p className="text-xs text-muted-foreground">
            {ok} succeeded, {noop} no-op
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
      <Card className="p-3">
        <RunsTable runs={runs} selected={selectedId ?? runs[cursor]?.id} onSelect={select} />
      </Card>
      <div className="mt-4 max-w-xl">
        <CopyCommand label="Start a run" command='hl run "<task>" --agent analyst --ticket <T> --mode plan' />
      </div>
    </PageLayout>
  );
}
