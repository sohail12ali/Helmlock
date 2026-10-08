// Suggested entries: my finished agent runs and ticket moves on the selected day with no log line yet. "Log" only
// pre-fills the quick add (ticket, first sentence of the outcome, source agent-run:<id>); nothing is written here.
import type { WorkSuggestion } from "@helmlock/core/contracts";
import { Bot, MoveRightIcon } from "lucide-react";
import { useWorkSuggestions } from "@/api/work";
import { Mono } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Chip, Panel, Skeleton } from "./bits";

export function SuggestionsPanel({ date, onLog }: { date: string; onLog: (s: WorkSuggestion) => void }) {
  const q = useWorkSuggestions(date);
  const items = q.data?.items ?? [];
  if (q.isSuccess && !items.length) return null;
  return (
    <Panel title="Suggested entries" right={items.length ? <Chip tone="accent">{items.length}</Chip> : undefined}>
      {q.isPending ? (
        <Skeleton rows={2} />
      ) : q.isError ? (
        <p className="text-muted-foreground">Suggestions are not available.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Suggested entries">
          {items.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-0">
              {s.kind === "run" ? (
                <Bot className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <MoveRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {s.ticket && <Mono className="shrink-0 text-[11px]">{s.ticket}</Mono>}
              <span className="min-w-0 flex-1 truncate" title={s.text}>
                {s.text || <span className="text-muted-foreground">no summary</span>}
              </span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{s.detail}</span>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" aria-label={`Log ${s.key}`} onClick={() => onLog(s)}>
                Log
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
