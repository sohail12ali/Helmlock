import type { RunSummary } from "@helmlock/core/contracts";
import { EmptyState, Mono, StatusChip, TicketLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { fmtCost, fmtDateTime, fmtTokens } from "@/lib/format";
import { runState, runTokens } from "@/lib/runs";
import { cn } from "@/lib/utils";

/** Runs list (mockup 13): trigger/agent chip, tokens, first result line; no-op runs are labelled (F134). */
export function RunsTable({
  runs,
  compact = false,
  selected,
  onSelect,
}: {
  runs: RunSummary[];
  compact?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  if (runs.length === 0)
    return (
      <EmptyState
        title="No agent runs yet."
        hint="Runs start only when a person or the dispatcher starts one."
        command='hl run "<task>" --agent analyst --ticket <T>'
      />
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-3 font-medium">Run</th>
            <th className="py-1.5 pr-3 font-medium">Agent</th>
            {!compact && <th className="py-1.5 pr-3 font-medium">Mode</th>}
            <th className="py-1.5 pr-3 font-medium">Ticket</th>
            <th className="py-1.5 pr-3 font-medium">State</th>
            <th className="py-1.5 pr-3 text-right font-medium">Tokens</th>
            {!compact && <th className="py-1.5 pr-3 font-medium">Result</th>}
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const state = runState(r);
            return (
              <tr
                key={r.id}
                data-nav-index={onSelect ? i : undefined}
                onClick={onSelect ? () => onSelect(r.id) : undefined}
                className={cn("border-b last:border-0", onSelect && "cursor-pointer hover:bg-accent", selected === r.id && "bg-accent")}
              >
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <Mono>{r.id}</Mono>
                  {!compact && <div className="text-xs text-muted-foreground">{fmtDateTime(r.started)}</div>}
                </td>
                <td className="py-1.5 pr-3">
                  <Badge variant="outline">{r.agent ?? r.runtime}</Badge>
                </td>
                {!compact && (
                  <td className="py-1.5 pr-3">
                    <Mono className="text-xs text-ink2">
                      {r.runtime}/{r.mode}
                    </Mono>
                  </td>
                )}
                <td className="py-1.5 pr-3">{r.ticket ? <TicketLink id={r.ticket} /> : <span className="text-muted-foreground">-</span>}</td>
                <td className="py-1.5 pr-3">
                  <StatusChip status={state} label={state === "failed" && r.failure_class ? `failed: ${r.failure_class}` : state} />
                </td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  <Mono>{fmtTokens(runTokens(r)) || "-"}</Mono>
                  {!compact && r.usage?.cost_usd != null && <div className="font-mono text-xs text-muted-foreground">{fmtCost(r.usage.cost_usd)}</div>}
                </td>
                {!compact && <td className="max-w-[28rem] truncate py-1.5 pr-3 text-ink2">{r.first_result_line ?? ""}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
