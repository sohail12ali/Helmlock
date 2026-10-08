// Pure helpers for the inbox (F67, F84): views, kind filters, where an item opens, and the "new activity" memory.
import type { ApprovalCard, InboxItem } from "@helmlock/core/contracts";

export type InboxView = "unread" | "all" | "archived";
export const VIEWS: { id: InboxView; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

export type Kind = InboxItem["kind"];
export const KIND_LABEL: Record<Kind, string> = {
  approval: "Approval",
  question: "Question",
  blocked: "Blocked",
  "run-failed": "Run failed",
  "claim-stale": "Stale claim",
  setup: "Setup",
  retention: "Retention",
};

export function inView(item: InboxItem, view: InboxView): boolean {
  if (view === "archived") return item.archived;
  if (view === "unread") return !item.archived && !item.read;
  return !item.archived;
}

/** Items of a view and kind filter, newest first. */
export function selectItems(items: InboxItem[], view: InboxView, kinds: ReadonlySet<Kind>): InboxItem[] {
  return items.filter((i) => inView(i, view) && (kinds.size === 0 || kinds.has(i.kind))).sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Where Enter takes an item. Approvals open their run or chat; tickets open on the ticket page. */
export function targetOf(item: InboxItem, card?: ApprovalCard): string | undefined {
  if (item.kind === "approval") {
    if (card?.run_id) return `/runs/${encodeURIComponent(card.run_id)}`;
    if (card?.chat_id) return "/chat";
    if (item.ticket) return `/t/${encodeURIComponent(item.ticket)}`;
    return undefined;
  }
  if (item.kind === "run-failed" && item.id) return `/runs/${encodeURIComponent(item.id)}`;
  if (item.ticket) return `/t/${encodeURIComponent(item.ticket)}${item.kind === "question" ? "?tab=questions" : ""}`;
  if (item.kind === "setup") return "/setup";
  if (item.kind === "run-failed") return "/crew";
  if (item.kind === "retention") return "/tickets";
  return undefined;
}

/** Short age such as "2 m", "3 h", "4 d". */
export function age(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 60) return `${m} m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

// The server decides when an archived item comes back (new activity). This browser remembers what it archived and at
// which `updated`, so a returning item can say why it is back.
const ARCHIVED_KEY = "hl.inbox.archived";

export function readArchived(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function rememberArchived(key: string, updated: string | undefined): void {
  try {
    const m = readArchived();
    if (updated === undefined) delete m[key];
    else m[key] = updated;
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: the chip is a convenience */
  }
}

/** Back from the archive with activity newer than when it was archived. */
export function resurfaced(item: InboxItem, archived: Record<string, string>): boolean {
  const at = archived[item.key];
  return !item.archived && at !== undefined && at !== item.updated;
}
