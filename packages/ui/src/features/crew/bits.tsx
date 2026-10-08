// Small shared pieces of the crew views: engine chips, run status, outcome badges, elapsed time.
import type { EngineView, OutcomeKind, RunOutcome, RunState } from "@helmlock/core/contracts";
import { useCrew } from "@/api/m8";
import { StatusChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { capitalize } from "@/lib/format";
import { cn } from "@/lib/utils";

export const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`;
export const threadPath = (ticket: string) => `/t/${encodeURIComponent(ticket)}?tab=thread`;

/** Engines known to the server, for labels; empty until /crew answers. */
export function useEngines(): EngineView[] {
  return useCrew().data?.engines ?? [];
}

export function engineLabel(engines: EngineView[], id: string | undefined): string {
  if (!id) return "engine";
  return engines.find((e) => e.id === id)?.label ?? id;
}

export function roleLabel(role: string | undefined, roles?: { id: string; label: string }[]): string {
  if (!role) return "Agent";
  return roles?.find((r) => r.id === role)?.label ?? capitalize(role);
}

export function EngineChip({ engine, problem, className }: { engine: string; problem?: string | false; className?: string }) {
  return (
    <Badge variant={problem ? "danger" : "accent"} className={className} title={problem || undefined} data-engine-chip>
      {engine}
    </Badge>
  );
}

export function ModelChip({ model }: { model?: string }) {
  if (!model) return null;
  return (
    <Badge variant="outline" className="font-mono">
      {model}
    </Badge>
  );
}

const RUN_TONE: Record<RunState["status"], string> = { queued: "backlog", running: "running", done: "succeeded", failed: "failed", cancelled: "no-op" };

export function RunStatusChip({ run }: { run: Pick<RunState, "status" | "failure_class"> }) {
  return <StatusChip status={RUN_TONE[run.status]} label={run.status === "failed" && run.failure_class ? `failed: ${run.failure_class}` : run.status} />;
}

const OUTCOME_TONE: Record<OutcomeKind, "ok" | "warn" | "danger"> = { done: "ok", review: "warn", blocked: "danger", "needs-input": "warn" };

export function OutcomeBadge({ outcome, className }: { outcome: RunOutcome | "none"; className?: string }) {
  if (outcome === "none")
    return (
      <Badge variant="default" className={className}>
        no outcome
      </Badge>
    );
  return (
    <Badge variant={OUTCOME_TONE[outcome.outcome]} className={cn("font-mono", className)}>
      {outcome.outcome}
    </Badge>
  );
}

/** "45 s", "4 min", "1 h 3 min". */
export function fmtElapsed(startIso: string, endMs: number): string {
  const ms = endMs - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const isLive = (r: Pick<RunState, "status">) => r.status === "running" || r.status === "queued";
