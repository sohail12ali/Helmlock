import type { ApprovalCard as Card } from "@helmlock/core/contracts";
import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { useApprovals } from "@/api/m4";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./ApprovalCard";

/** Pending cards, optionally only those of one run or chat. Renders nothing when there are none. */
export function PendingApprovals({
  runId,
  chatId,
  className,
  showSource = true,
}: {
  runId?: string;
  chatId?: string;
  className?: string;
  showSource?: boolean;
}) {
  const q = useApprovals("pending");
  const cards = filterCards(q.data ?? [], runId, chatId);
  if (cards.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-2", className)} aria-label="Pending approvals">
      {cards.map((c) => (
        <li key={c.id}>
          <ApprovalCard card={c} showSource={showSource} />
        </li>
      ))}
    </ul>
  );
}

export function filterCards(cards: Card[], runId?: string, chatId?: string): Card[] {
  return cards.filter((c) => c.status === "pending" && (!runId || c.run_id === runId) && (!chatId || c.chat_id === chatId));
}

/** Top-bar badge: how many decisions are waiting. Hidden at zero. */
export function ApprovalsBadge() {
  const q = useApprovals("pending");
  const n = (q.data ?? []).filter((c) => c.status === "pending").length;
  if (!n) return null;
  return (
    <Link
      to="/inbox"
      className="inline-flex h-7 items-center gap-1 rounded-full bg-warn/15 px-2 font-mono text-xs text-warn hover:bg-warn/25"
      aria-label={`${n} approval${n === 1 ? "" : "s"} waiting`}
      title="Approvals waiting for you"
    >
      <ShieldAlert className="size-3.5" />
      {n}
    </Link>
  );
}
