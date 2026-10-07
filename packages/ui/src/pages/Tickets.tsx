import type { Board, TicketCard } from "@helmlock/core/contracts";
import { AlertTriangle, Columns3, List, MessageCircleQuestion, Search } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useBoard, useStageLabel, useWorkspace } from "@/api/hooks";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, PageHeader, StatusChip } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { TicketDrawer } from "@/components/TicketBits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VirtualList } from "@/components/VirtualList";
import { useListNav } from "@/lib/keys";
import { readPref, writePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

interface Filters {
  mine: boolean;
  blocked: boolean;
  size: string;
  text: string;
  stage: string;
}

export function filterTickets(tickets: TicketCard[], f: Filters, me: string | undefined): TicketCard[] {
  const text = f.text.trim().toLowerCase();
  return tickets.filter(
    (t) =>
      (!f.mine || (me !== undefined && (t.owner === me || t.claimed_by === me))) &&
      (!f.blocked || t.blocked) &&
      (!f.size || t.size === f.size) &&
      (!f.stage || t.stage === f.stage) &&
      (!text || t.id.toLowerCase().includes(text) || t.title.toLowerCase().includes(text)),
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs",
        active ? "border-primary bg-accent text-primary" : "text-ink2 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function CardBody({ t }: { t: TicketCard }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Mono className="text-xs text-primary">{t.id}</Mono>
        {t.priority !== "normal" && <StatusChip status={t.priority} className="py-0" />}
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm">{t.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {t.size && <Badge variant="outline">{t.size}</Badge>}
        {t.blocked && (
          <Badge variant="danger" title={t.blocked_by}>
            <AlertTriangle />
            blocked
          </Badge>
        )}
        {t.open_questions > 0 && (
          <Badge variant="warn" title="Open questions">
            <MessageCircleQuestion />
            {t.open_questions}
          </Badge>
        )}
        {t.tasks.total > 0 && (
          <Badge variant="default" title="Tasks done">
            <Mono>
              {t.tasks.done}/{t.tasks.total}
            </Mono>
          </Badge>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{t.claimed_by ?? t.owner ?? ""}</span>
      </div>
    </>
  );
}

function BoardView({
  board,
  tickets,
  selected,
  cursor,
  onOpen,
}: {
  board: Board;
  tickets: TicketCard[];
  selected?: string;
  cursor?: string;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="flex gap-3 overflow-x-auto pb-2" aria-label="Board">
      {board.stages.map((s) => {
        const lane = tickets.filter((t) => t.stage === s.id);
        const over = s.wip !== undefined && s.count > s.wip;
        return (
          <li key={s.id} aria-label={`${s.label} lane`} className="flex w-64 shrink-0 flex-col rounded-lg bg-sunk/70 p-2">
            <header className="mb-2 flex items-center gap-2 px-1">
              <h2 className="text-sm font-semibold">{s.label}</h2>
              <Mono
                className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}
                aria-label={s.wip ? `WIP ${s.count} of ${s.wip}` : `${s.count} tickets`}
              >
                {s.wip !== undefined ? `${s.count}/${s.wip}` : s.count}
              </Mono>
              {s.agent && <span className="ml-auto text-xs text-muted-foreground">{s.agent}</span>}
            </header>
            <div className="flex flex-col gap-2">
              {lane.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">Empty</p>}
              {lane.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  data-nav-id={t.id}
                  onClick={() => onOpen(t.id)}
                  className={cn(
                    "rounded-md border bg-card p-2.5 text-left shadow-xs hover:border-primary/50",
                    selected === t.id && "border-primary ring-1 ring-primary",
                    cursor === t.id && selected !== t.id && "ring-1 ring-primary/40",
                    t.blocked && "border-l-2 border-l-destructive",
                  )}
                >
                  <CardBody t={t} />
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ListView({
  tickets,
  selected,
  cursor,
  onOpen,
  stageLabel,
}: {
  tickets: TicketCard[];
  selected?: string;
  cursor?: string;
  onOpen: (id: string) => void;
  stageLabel: (s: string) => string;
}) {
  const cols = "grid grid-cols-[7rem_1fr_6rem_3rem_5rem_4rem] items-center gap-2 px-2";
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div aria-hidden className={cn(cols, "min-w-[40rem] border-b py-1.5 text-xs text-muted-foreground")}>
        <span>Id</span>
        <span>Title</span>
        <span>Stage</span>
        <span>Size</span>
        <span>Owner</span>
        <span className="text-right">Tasks</span>
      </div>
      {/* A list of row buttons rather than a table, so long lists can be windowed (F109). */}
      <VirtualList
        items={tickets}
        rowHeight={37}
        as="ul"
        label="Tickets"
        className="min-w-[40rem]"
        render={(t) => (
          <li key={t.id}>
            <button
              type="button"
              data-nav-id={t.id}
              onClick={() => onOpen(t.id)}
              className={cn(
                cols,
                "h-[37px] w-full cursor-pointer border-b text-left text-sm hover:bg-accent",
                (selected === t.id || cursor === t.id) && "bg-accent",
              )}
            >
              <Mono className="text-xs text-primary">{t.id}</Mono>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{t.title}</span>
                {t.blocked && <Badge variant="danger">blocked</Badge>}
              </span>
              <span>
                <StatusChip status={t.stage} label={stageLabel(t.stage)} />
              </span>
              <span>{t.size ?? ""}</span>
              <Mono className="text-xs">{t.owner ?? ""}</Mono>
              <Mono className="text-right text-xs">{t.tasks.total ? `${t.tasks.done}/${t.tasks.total}` : ""}</Mono>
            </button>
          </li>
        )}
      />
    </div>
  );
}

export function TicketsPage() {
  const board = useBoard();
  const ws = useWorkspace();
  const stageLabel = useStageLabel();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") ?? readPref("tickets.view", "board", ["board", "list"] as const)) as "board" | "list";
  const filters: Filters = {
    mine: params.get("mine") === "1",
    blocked: params.get("blocked") === "1",
    size: params.get("size") ?? "",
    text: params.get("q") ?? "",
    stage: params.get("stage") ?? "",
  };
  const selected = params.get("t") ?? undefined;
  const me = ws.data?.author?.id;

  const set = (k: string, v: string | undefined) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const visible = board.data ? filterTickets(board.data.tickets, filters, me) : [];
  // Keyboard order follows what is on screen: lane by lane on the board, row by row in the list.
  const stages = board.data?.stages;
  const ordered = view === "list" || !stages ? visible : stages.flatMap((s) => visible.filter((t) => t.stage === s.id));

  const open = (id: string) => set("t", id);
  const [cursorIdx] = useListNav(ordered.length, (i) => {
    const t = ordered[i];
    if (!t) return;
    if (selected === t.id) navigate(`/t/${encodeURIComponent(t.id)}`);
    else open(t.id);
  });
  const cursor = ordered[cursorIdx]?.id;
  useEffect(() => {
    if (cursor) document.querySelector(`[data-nav-id="${cursor.replace(/["\\]/g, "\\$&")}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor]);

  if (board.isPending) return <Loading />;
  if (board.isError)
    return (
      <div className="p-4">
        <ErrorState error={board.error} />
      </div>
    );
  const blockedCount = board.data.tickets.filter((t) => t.blocked).length;

  return (
    <PageLayout
      id="tickets"
      rightTitle="Ticket"
      right={selected ? <TicketDrawer id={selected} stageLabel={stageLabel} /> : undefined}
      onCloseRight={() => set("t", undefined)}
    >
      <PageHeader title="Tickets">
        <fieldset className="inline-flex rounded-md border p-0.5" aria-label="View">
          {(["board", "list"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "secondary" : "ghost"}
              aria-pressed={view === v}
              onClick={() => {
                writePref("tickets.view", v);
                set("view", v);
              }}
            >
              {v === "board" ? <Columns3 /> : <List />}
              {v === "board" ? "Board" : "List"}
            </Button>
          ))}
        </fieldset>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className="relative w-full max-w-60 sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.text}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Filter tickets"
            aria-label="Filter tickets"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Chip active={filters.mine} onClick={() => set("mine", filters.mine ? undefined : "1")}>
          Mine
        </Chip>
        <Chip active={filters.blocked} onClick={() => set("blocked", filters.blocked ? undefined : "1")}>
          Blocked <Mono>{blockedCount}</Mono>
        </Chip>
        {(["S", "M", "L"] as const).map((s) => (
          <Chip key={s} active={filters.size === s} onClick={() => set("size", filters.size === s ? undefined : s)}>
            Size {s}
          </Chip>
        ))}
        {filters.stage && (
          <Chip active onClick={() => set("stage", undefined)}>
            Stage: {stageLabel(filters.stage)} ×
          </Chip>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          <Mono>{visible.length}</Mono> of <Mono>{board.data.tickets.length}</Mono>
        </span>
      </div>

      {board.data.tickets.length === 0 ? (
        <EmptyState title="No tickets yet." hint="Create the first one from the CLI or ask the dispatcher." command='hl ticket new "<title>"' />
      ) : visible.length === 0 ? (
        <EmptyState title="No tickets match these filters." hint="Clear a filter chip or the text filter." />
      ) : view === "board" ? (
        <BoardView board={board.data} tickets={visible} selected={selected} cursor={cursor} onOpen={open} />
      ) : (
        <ListView tickets={visible} selected={selected} cursor={cursor} onOpen={open} stageLabel={stageLabel} />
      )}
      <div className="mt-4 max-w-md">
        <CopyCommand label="New ticket" command='hl ticket new "<title>" --size M' />
      </div>
    </PageLayout>
  );
}
