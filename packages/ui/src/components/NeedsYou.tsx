import type { NeedsYouItem } from "@helmlock/core/contracts";
import { AlertTriangle, CircleHelp, Clock, Cog, XCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { useApprovals } from "@/api/m4";
import { NeedsYouQuestionCard } from "@/components/actions/RecordActions";
import { EmptyState, Mono } from "@/components/common";
import { PendingApprovals } from "@/features/approvals/PendingApprovals";
import { useListNav } from "@/lib/keys";
import { cn } from "@/lib/utils";

const ICON = { blocked: AlertTriangle, question: CircleHelp, "claim-stale": Clock, setup: Cog, "run-failed": XCircle } as const;
const KIND_LABEL = { blocked: "Blocked", question: "Question", "claim-stale": "Stale claim", setup: "Setup", "run-failed": "Run failed" } as const;

function target(item: NeedsYouItem): string | undefined {
  if (item.ticket) return `/t/${encodeURIComponent(item.ticket)}${item.kind === "question" ? "?tab=questions" : ""}`;
  if (item.kind === "setup") return "/setup";
  if (item.kind === "run-failed") return "/agents";
  return undefined;
}

export function NeedsYouList({ items, keyboard = true }: { items: NeedsYouItem[]; keyboard?: boolean }) {
  const navigate = useNavigate();
  const [sel, setSel] = useListNav(
    items.length,
    (i) => {
      const t = items[i] && target(items[i]);
      if (t) navigate(t);
    },
    keyboard,
  );

  // Milestone 4: approval cards come first; they expire.
  const approvals = useApprovals("pending");
  const waiting = (approvals.data ?? []).some((c) => c.status === "pending");

  if (items.length === 0)
    return waiting ? (
      <PendingApprovals className="px-2 py-1" />
    ) : (
      <EmptyState title="Nothing needs you right now." hint="Blocked tickets, open blocking questions, approvals and failed runs show up here." />
    );

  return (
    <>
      <PendingApprovals className="px-2 py-1" />
      <ul className="divide-y" aria-label="Needs you">
        {items.map((item, i) => {
          const Icon = ICON[item.kind] ?? CircleHelp;
          const to = target(item);
          const urgent = item.kind === "blocked" || item.kind === "run-failed";
          return (
            <li key={`${item.kind}-${item.id ?? item.ticket ?? i}`} data-nav-index={i}>
              {/* biome-ignore lint/a11y/useSemanticElements: a row with nested links */}
              <div
                role="button"
                tabIndex={-1}
                onClick={() => to && navigate(to)}
                onKeyDown={(e) => e.key === "Enter" && to && navigate(to)}
                onMouseEnter={() => setSel(i)}
                className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-accent", sel === i && "bg-accent ring-1 ring-primary/40")}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", urgent ? "text-destructive" : "text-warn")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                    {item.ticket && <Mono className="text-xs text-primary">{item.ticket}</Mono>}
                    {item.id && item.id !== item.ticket && <Mono className="text-xs text-ink2">{item.id}</Mono>}
                  </div>
                  <p className="truncate">{item.title}</p>
                  {item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
                </div>
              </div>
              {item.kind === "question" && item.ticket && item.id && (
                <div className="pb-2 pl-8">
                  <NeedsYouQuestionCard ticket={item.ticket} id={item.id} text={item.title} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
