// Inbox (F67, F84, mockup 05): items derived from the files plus this person's read and archive state.
// Views Unread / All / Archived, kind chips, j/k move, Enter opens (and marks read), e archives, u toggles read.
import type { InboxItem } from "@helmlock/core/contracts";
import { AlertTriangle, Archive, ArchiveRestore, CircleHelp, Clock, Cog, Mail, MailOpen, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "@/api/client";
import { useOverview } from "@/api/hooks";
import { useApprovals } from "@/api/m4";
import { useInbox, useInboxState } from "@/api/m5";
import { NeedsYouQuestionCard } from "@/components/actions/RecordActions";
import { EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { NeedsYouList } from "@/components/NeedsYou";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/input";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { isTyping, useListNav } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { age, type InboxView, inView, KIND_LABEL, type Kind, readArchived, rememberArchived, resurfaced, selectItems, targetOf, VIEWS } from "./inbox-state";

const ICON: Record<Kind, typeof CircleHelp> = {
  approval: ShieldAlert,
  question: CircleHelp,
  blocked: AlertTriangle,
  "run-failed": XCircle,
  "claim-stale": Clock,
  setup: Cog,
  retention: Trash2,
};
const URGENT = new Set<Kind>(["approval", "blocked", "run-failed"]);

const EMPTY: Record<InboxView, { title: string; hint: string }> = {
  unread: { title: "Inbox zero.", hint: "Pick a ticket from the board, or look at All for what you have already read." },
  all: { title: "Nothing needs you right now.", hint: "Approvals, blocking questions, blocked tickets and failed runs show up here." },
  archived: { title: "Nothing archived.", hint: "Press e on an item to archive it. It comes back here when it has new activity." },
};

/** Before the server has the inbox route: the focused Needs-you view (milestone 2 to 4 behaviour). */
function Fallback() {
  const q = useOverview();
  return q.isPending ? (
    <Loading />
  ) : q.isError ? (
    <ErrorState error={q.error} />
  ) : (
    <Card>
      <CardContent className="px-2 pt-2">
        <NeedsYouList items={q.data.needs_you} />
      </CardContent>
    </Card>
  );
}

function Row({
  item,
  selected,
  isNew,
  onSelect,
  onOpen,
  onArchive,
  onRead,
  index,
}: {
  item: InboxItem;
  selected: boolean;
  isNew: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onRead: () => void;
  index: number;
}) {
  const Icon = ICON[item.kind] ?? CircleHelp;
  const approvals = useApprovals("pending");
  const card = item.kind === "approval" ? (approvals.data ?? []).find((c) => c.id === (item.id ?? item.key)) : undefined;
  return (
    <li data-nav-index={index} data-inbox-key={item.key} aria-label={item.title} aria-current={selected || undefined}>
      {/* biome-ignore lint/a11y/useSemanticElements: a row with nested buttons */}
      <div
        role="button"
        tabIndex={-1}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        onMouseEnter={onSelect}
        className={cn(
          "group flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-accent",
          selected && "bg-accent ring-1 ring-primary/40",
          !item.read && "font-medium",
        )}
      >
        <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
          {!item.read && <span className="size-2 rounded-full bg-primary" />}
        </span>
        <Icon className={cn("mt-0.5 size-4 shrink-0", URGENT.has(item.kind) ? "text-destructive" : "text-warn")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-normal text-muted-foreground">{KIND_LABEL[item.kind] ?? item.kind}</span>
            {item.ticket && <Mono className="text-xs text-primary">{item.ticket}</Mono>}
            {item.id && item.id !== item.ticket && item.kind !== "approval" && <Mono className="text-xs font-normal text-ink2">{item.id}</Mono>}
            {isNew && (
              <Badge variant="accent" data-testid="new-activity">
                new activity
              </Badge>
            )}
            {!item.read && <span className="sr-only">unread</span>}
          </div>
          <p className="truncate">{item.title}</p>
          {item.detail && <p className="truncate text-xs font-normal text-muted-foreground">{item.detail}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          {/* Setup items carry no real time (a fixed epoch keeps them archived once archived): show no age. */}
          {Date.parse(item.updated) > 0 && (
            <Mono className="mr-1 text-xs font-normal text-muted-foreground" title={item.updated}>
              {age(item.updated)}
            </Mono>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={item.read ? `Mark unread: ${item.title}` : `Mark read: ${item.title}`}
            title={item.read ? "Mark unread (u)" : "Mark read (u)"}
            onClick={(e) => {
              e.stopPropagation();
              onRead();
            }}
          >
            {item.read ? <Mail /> : <MailOpen />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={item.archived ? `Unarchive: ${item.title}` : `Archive: ${item.title}`}
            title={item.archived ? "Move back to the inbox (e)" : "Archive (e)"}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            {item.archived ? <ArchiveRestore /> : <Archive />}
          </Button>
        </span>
      </div>
      {card && (
        <div className="pb-2 pl-10">
          <ApprovalCard card={card} />
        </div>
      )}
      {item.kind === "question" && item.ticket && item.id && !item.archived && (
        <div className="pb-2 pl-10">
          <NeedsYouQuestionCard ticket={item.ticket} id={item.id} text={item.title} />
        </div>
      )}
    </li>
  );
}

function InboxList({ items }: { items: InboxItem[] }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.id === params.get("view")) ? params.get("view") : "unread") as InboxView;
  const [kinds, setKinds] = useState<Set<Kind>>(new Set());
  const [archivedMemo, setArchivedMemo] = useState(readArchived);
  const state = useInboxState();
  const approvals = useApprovals("pending");

  const shown = useMemo(() => selectItems(items, view, kinds), [items, view, kinds]);
  const presentKinds = useMemo(() => [...new Set(items.filter((i) => inView(i, view)).map((i) => i.kind))].sort(), [items, view]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, items.filter((i) => inView(i, v.id)).length])), [items]);

  const forget = (key: string) => {
    rememberArchived(key, undefined);
    setArchivedMemo(readArchived());
  };
  const setRead = (item: InboxItem, read: boolean) => {
    if (read) forget(item.key);
    if (item.read !== read) state.mutate({ key: item.key, read });
  };
  const toggleArchive = (item: InboxItem) => {
    if (item.archived) forget(item.key);
    else {
      rememberArchived(item.key, item.updated);
      setArchivedMemo(readArchived());
    }
    state.mutate({ key: item.key, archived: !item.archived });
  };
  const open = (item: InboxItem) => {
    setRead(item, true);
    const card = (approvals.data ?? []).find((c) => c.id === (item.id ?? item.key));
    const to = targetOf(item, card);
    if (to) navigate(to);
  };

  const [sel, setSel] = useListNav(shown.length, (i) => shown[i] && open(shown[i]));

  // e archives, u toggles read, on the selected row.
  const ref = useRef({ shown, sel, toggleArchive, setRead });
  ref.current = { shown, sel, toggleArchive, setRead };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || document.querySelector('[role="dialog"]')) return;
      if (e.key !== "e" && e.key !== "u") return;
      const { shown: list, sel: i } = ref.current;
      const item = list[i];
      if (!item) return;
      e.preventDefault();
      if (e.key === "e") ref.current.toggleArchive(item);
      else ref.current.setRead(item, !item.read);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const setView = (v: InboxView) => {
    setKinds(new Set());
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === "unread") n.delete("view");
        else n.set("view", v);
        return n;
      },
      { replace: true },
    );
  };
  const toggleKind = (k: Kind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Inbox views" className="flex items-center gap-1 overflow-x-auto border-b">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
              view === v.id && "border-primary text-foreground",
            )}
          >
            {v.label}
            <Mono className="text-xs text-muted-foreground">{counts[v.id]}</Mono>
          </button>
        ))}
      </div>
      {presentKinds.length > 1 && (
        <fieldset className="flex flex-wrap gap-1.5" aria-label="Filter by kind">
          {presentKinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kinds.has(k)}
              onClick={() => toggleKind(k)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs",
                kinds.has(k) ? "border-primary bg-accent text-primary" : "text-ink2 hover:bg-accent",
              )}
            >
              {KIND_LABEL[k] ?? k}
            </button>
          ))}
        </fieldset>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={kinds.size ? "Nothing of this kind here." : EMPTY[view].title}
          hint={
            kinds.size ? (
              "Clear the kind filter to see everything in this view."
            ) : view === "unread" ? (
              <>
                {EMPTY.unread.hint} <Link to="/tickets">Open the board</Link>
              </>
            ) : (
              EMPTY[view].hint
            )
          }
        />
      ) : (
        <Card>
          <CardContent className="px-2 pt-2">
            <ul className="divide-y" aria-label="Inbox items">
              {shown.map((item, i) => (
                <Row
                  key={item.key}
                  index={i}
                  item={item}
                  selected={sel === i}
                  isNew={!item.read && resurfaced(item, archivedMemo)}
                  onSelect={() => setSel(i)}
                  onOpen={() => open(item)}
                  onArchive={() => toggleArchive(item)}
                  onRead={() => setRead(item, !item.read)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <p className="hidden flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:flex">
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
        <span>
          <Kbd>e</Kbd> archive
        </span>
        <span>
          <Kbd>u</Kbd> read or unread
        </span>
      </p>
    </div>
  );
}

export function InboxPage() {
  const q = useInbox();
  const unavailable = q.isError && q.error instanceof ApiError && q.error.status === 404;
  return (
    <PageLayout id="inbox">
      <PageHeader title="Inbox" />
      {q.isPending ? <Loading /> : unavailable ? <Fallback /> : q.isError ? <ErrorState error={q.error} /> : <InboxList items={q.data} />}
    </PageLayout>
  );
}
