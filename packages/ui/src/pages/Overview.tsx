import type { ActivityLine, Overview as OverviewData, StageDef, WorkLogLine } from "@helmlock/core/contracts";
import { Link } from "react-router";
import { useOverview } from "@/api/hooks";
import { useSetup } from "@/api/m5";
import { EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { NeedsYouList } from "@/components/NeedsYou";
import { RunsTable } from "@/components/RunsTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtTime, fmtTokens } from "@/lib/format";
import { runState, runTokens } from "@/lib/runs";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint, highlight }: { label: string; value: string | number; hint?: string; highlight?: boolean }) {
  return (
    <Card className={cn("px-4 py-3", highlight && "border-primary/50")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-semibold", highlight && "text-primary")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function StageBars({ stages }: { stages: (StageDef & { count: number })[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Tickets by stage">
      {stages.map((s) => (
        <li key={s.id}>
          <Link to={`/tickets?stage=${encodeURIComponent(s.id)}`} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-sm hover:text-primary">
            <span className="truncate">{s.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunk">
              <span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${s.count / max})` }} />
            </span>
            <Mono className="text-right">{s.count}</Mono>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "Finish setup (n left)" until the required first-run steps (GET /setup) are done. Hidden when the server has none. */
function FinishSetup() {
  const q = useSetup();
  const open = (q.data?.steps ?? []).filter((s) => !s.done && !s.optional);
  if (!open.length) return null;
  return (
    <Card role="region" className="mb-3 flex flex-wrap items-center gap-2 border-primary/40 px-4 py-3" aria-label="Finish setup">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Finish setup ({open.length} left)</p>
        <p className="truncate text-xs text-muted-foreground">Next: {open.map((s) => s.label).join(", ")}</p>
      </div>
      <Button size="sm" asChild>
        <Link to="/welcome">Continue setup</Link>
      </Button>
    </Card>
  );
}

function needsYouHint(o: OverviewData): string {
  const counts = new Map<string, number>();
  for (const n of o.needs_you) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const words: Record<string, string> = {
    blocked: "blocked",
    question: "questions",
    "claim-stale": "stale claims",
    setup: "setup",
    "run-failed": "failed runs",
  };
  return [...counts].map(([k, n]) => `${n} ${words[k] ?? k}`).join(", ") || "all clear";
}

function activityText(a: ActivityLine): string {
  return `${a.actor.kind === "agent" ? `${a.actor.id} ` : ""}${a.verb}${a.entity ? ` ${a.entity}` : ""}${a.code === 2 ? " (blocked)" : a.code === 1 ? " (failed)" : ""}`;
}

function Today({ worklog, activity }: { worklog: WorkLogLine[]; activity: ActivityLine[] }) {
  const recent = [...activity].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 12);
  return (
    <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Work log</h3>
        {worklog.length === 0 ? (
          <EmptyState title="No work logged today." command='hl log-work <T> "<one sentence>"' />
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {worklog.map((w) => (
              <li key={`${w.ticket}-${w.text}`} className="flex gap-2">
                <Link to={`/t/${encodeURIComponent(w.ticket)}`} className="shrink-0 font-mono text-xs leading-5 text-primary hover:underline">
                  {w.ticket}
                </Link>
                <span className="min-w-0 flex-1">{w.text}</span>
                <Mono className="shrink-0 text-xs leading-5 text-muted-foreground">{w.hours_alloc}h</Mono>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Activity</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet today.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {recent.map((a) => (
              <li key={`${a.ts}-${a.verb}-${a.entity ?? ""}`} className="flex gap-2">
                <Mono className="shrink-0 text-xs leading-5 text-muted-foreground">{fmtTime(a.ts)}</Mono>
                <span className="min-w-0 truncate">{activityText(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const q = useOverview();
  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <div className="p-4">
        <ErrorState error={q.error} />
      </div>
    );
  const o = q.data;
  const today = o.today.date;
  const runsToday = o.runs.filter((r) => r.started.startsWith(today));
  const tokensToday = runsToday.reduce((n, r) => n + (runTokens(r) ?? 0), 0);
  const live = o.runs.filter((r) => runState(r) === "running").length;

  return (
    <PageLayout id="overview">
      <PageHeader title="Overview" />
      <FinishSetup />
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Stat label="Needs you" value={o.needs_you.length} hint={needsYouHint(o)} highlight={o.needs_you.length > 0} />
        <Stat label="In progress" value={o.in_progress} hint={live ? `${live} agent run${live > 1 ? "s" : ""} live` : "no runs live"} />
        <Stat label="Done this week" value={o.done_this_week} />
        <Stat label="Model usage" value={`${fmtTokens(tokensToday) || 0} tok`} hint={`today, ${runsToday.length} run${runsToday.length === 1 ? "" : "s"}`} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 @3xl:grid-cols-3">
        <Card className="@3xl:col-span-2" id="inbox">
          <CardHeader>
            <CardTitle>Needs you</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/inbox">Open inbox</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-2">
            <NeedsYouList items={o.needs_you} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tickets by stage</CardTitle>
          </CardHeader>
          <CardContent>
            <StageBars stages={o.stages} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <Mono className="text-xs text-muted-foreground">{today}</Mono>
          </CardHeader>
          <CardContent className="@container">
            <Today worklog={o.today.worklog} activity={o.today.activity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Agent runs</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/crew">Crew</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <RunsTable runs={o.runs.slice(0, 8)} compact />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
