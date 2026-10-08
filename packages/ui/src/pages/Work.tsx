// Work (F6b, F93, Blueprint 14), rebuilt as a mixture of control-center (panels, chips, bars, stacked category bar,
// tight density) and lc-wms (weights and pinned hours on an 8 h floor, overtime and shortfall, day-length evidence,
// drafts from finished runs, field search, quick picks). Allocation stays on the server, identical to `hl log show`.
import type { WorkSearchResult, WorkSuggestion } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import { api } from "@/api/client";
import { keys } from "@/api/hooks";
import { useWorkConfig, useWorkDay, useWorkRange, useWorkSearch } from "@/api/work";
import { ErrorState, Mono, PageHeader, TicketLink } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatDot, Chip, Empty, Panel, Seg, Skeleton } from "@/features/work/bits";
import { AuthorCard } from "@/features/work/DayView";
import { type Prefill, QuickAdd } from "@/features/work/QuickAdd";
import { RangeSummary } from "@/features/work/RangeView";
import { SuggestionsPanel } from "@/features/work/Suggestions";
import { TimesheetPanel } from "@/features/work/Timesheet";
import { addDays, addMonths, DEFAULT_CATEGORIES, fmtH, iso, mondayOf, monthEnd, monthStart, previousWorkday } from "@/features/work/text";
import { WeekGrid } from "@/features/work/WeekView";

export { MAX_TEXT } from "@/features/work/text";
export const CATEGORIES = DEFAULT_CATEGORIES;

type View = "day" | "week" | "month" | "range";
const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "range", label: "Range" },
];

function SearchResults({ data, names, onOpen }: { data: WorkSearchResult; names: Record<string, string>; onOpen: (date: string, author: string) => void }) {
  return (
    <Panel title="Search results" right={<Chip tone="accent">{data.total}</Chip>}>
      {!data.hits.length ? (
        <Empty icon={SearchIcon} title="No matching lines" hint="Terms are ANDed. Narrow with ticket: cat: who: date: src: text: and exclude with -term." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label="Search results">
            <thead>
              <tr className="border-b text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="py-1 pr-2 font-semibold">Date</th>
                <th className="py-1 pr-2 font-semibold">Who</th>
                <th className="py-1 pr-2 font-semibold">Ticket</th>
                <th className="py-1 pr-2 font-semibold">Work</th>
                <th className="py-1 text-right font-semibold">Hours</th>
              </tr>
            </thead>
            <tbody>
              {data.hits.map((h) => (
                <tr key={`${h.date}-${h.author}-${h.id}`} className="border-b last:border-0 hover:bg-sunk/50">
                  <td className="py-1 pr-2">
                    <button type="button" className="font-mono text-primary hover:underline" onClick={() => onOpen(h.date, h.author)}>
                      {h.date}
                    </button>
                  </td>
                  <td className="py-1 pr-2">{names[h.author] ?? h.author}</td>
                  <td className="py-1 pr-2">{/^T-\d/.test(h.ticket) ? <TicketLink id={h.ticket} /> : <Mono>{h.ticket}</Mono>}</td>
                  <td className="py-1 pr-2">
                    <span className="inline-flex items-start gap-1.5">
                      <CatDot category={h.category} className="mt-1" />
                      {h.text}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{fmtH(h.hours_alloc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.hits.length && (
            <p className="pt-1 text-muted-foreground">
              Showing {data.hits.length} of {data.total}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function WorkPage({ now = new Date() }: { now?: Date }) {
  const today = iso(now);
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(addDays(today, -13));
  const [rangeEnd, setRangeEnd] = useState(today);
  const [who, setWho] = useState("me");
  const [search, setSearch] = useState("");
  const [prefill, setPrefill] = useState<Prefill>();
  const q = useDeferredValue(search.trim());

  const cfg = useWorkConfig();
  const me = cfg.data?.me?.id ?? null;
  const author = who === "" ? undefined : who;
  const names = useMemo(() => Object.fromEntries((cfg.data?.authors ?? []).map((a) => [a.id, a.name])), [cfg.data]);

  const span =
    view === "week"
      ? { start: mondayOf(date), end: addDays(mondayOf(date), 6) }
      : view === "month"
        ? { start: monthStart(date), end: monthEnd(date) }
        : { start: rangeStart, end: rangeEnd };
  const day = useWorkDay(date, author);
  const range = useWorkRange(span.start, span.end, author, view !== "day" && span.start <= span.end);
  const found = useWorkSearch(q, author);
  const yesterday = useWorkDay(previousWorkday(date), "me", !!me);
  const recent = useWorkRange(addDays(today, -14), today, "me", !!me);
  const tickets = useQuery({ queryKey: keys.tickets(), queryFn: ({ signal }) => api.tickets(undefined, signal) });

  const ticketOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; title?: string }[] = [];
    const titles = Object.fromEntries((tickets.data ?? []).map((t) => [t.id, t.title]));
    for (const c of [...(recent.data?.cells ?? [])].reverse()) {
      if (seen.has(c.ticket)) continue;
      seen.add(c.ticket);
      out.push({ id: c.ticket, ...(titles[c.ticket] ? { title: titles[c.ticket] } : {}) });
    }
    for (const t of tickets.data ?? []) {
      if (t.stage === "done" || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title });
    }
    return out;
  }, [recent.data, tickets.data]);

  const step = (n: number) => {
    if (view === "day") setDate(addDays(date, n));
    else if (view === "week") setDate(addDays(date, 7 * n));
    else if (view === "month") setDate(addMonths(date, n));
    else {
      const len = Math.round((new Date(`${rangeEnd}T12:00:00`).getTime() - new Date(`${rangeStart}T12:00:00`).getTime()) / 86_400_000) + 1;
      setRangeStart(addDays(rangeStart, n * len));
      setRangeEnd(addDays(rangeEnd, n * len));
    }
  };
  const openDay = (d: string, a?: string) => {
    setDate(d);
    if (a) setWho(a === me ? "me" : a);
    setView("day");
    setSearch("");
  };
  const logSuggestion = (s: WorkSuggestion) =>
    setPrefill({ ...(s.ticket ? { ticket: s.ticket } : {}), text: s.text, ...(s.source ? { source: s.source } : {}) });

  const categories = cfg.data?.categories ?? [...DEFAULT_CATEGORIES];
  const sheets = day.data?.sheets ?? [];

  let main: ReactNode;
  if (q) {
    main = found.isPending ? (
      <Skeleton />
    ) : found.isError ? (
      <ErrorState error={found.error} />
    ) : (
      <SearchResults data={found.data} names={names} onOpen={openDay} />
    );
  } else if (view === "day") {
    main = day.isPending ? (
      <Panel title="Loading">
        <Skeleton />
      </Panel>
    ) : day.isError ? (
      <ErrorState error={day.error} />
    ) : !sheets.length ? (
      <Panel title={`Work on ${date}`}>
        <Empty
          icon={ClockIcon}
          title={`No work logged on ${date}`}
          hint="Add a line above, or log a suggested entry. Weighted lines share the day; pinned hours stand."
        />
      </Panel>
    ) : (
      <div className="flex flex-col gap-3">
        {sheets.map((s) => (
          <AuthorCard key={s.author} sheet={s} mine={s.author === me} categories={categories} />
        ))}
      </div>
    );
  } else {
    main = range.isPending ? (
      <Panel title="Loading">
        <Skeleton />
      </Panel>
    ) : range.isError ? (
      <ErrorState error={range.error} />
    ) : view === "week" ? (
      <Panel title={`Week of ${span.start}`} right={<Chip tone="accent">{fmtH(range.data.total)}</Chip>}>
        <WeekGrid range={range.data} mode={author ? "tickets" : "people"} today={today} names={names} onOpen={openDay} />
      </Panel>
    ) : (
      <RangeSummary range={range.data} names={names} />
    );
  }

  return (
    <PageLayout id="work">
      <PageHeader title="Work">
        {day.data && (
          <span className="text-xs text-muted-foreground">
            {date} · <Mono>{fmtH(sheets.reduce((s, x) => s + x.total, 0))}</Mono>
          </span>
        )}
      </PageHeader>
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="toolbar" aria-label="Work view">
          <Seg label="View" value={view} options={VIEWS} onChange={setView} />
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="Previous" onClick={() => step(-1)}>
              <ChevronLeftIcon />
            </Button>
            {view === "range" ? (
              <>
                <Input aria-label="Range start" type="date" className="h-7 w-36 text-xs" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input aria-label="Range end" type="date" className="h-7 w-36 text-xs" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
              </>
            ) : (
              <Input aria-label="Date" type="date" className="h-7 w-36 text-xs" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            )}
            <Button size="icon-sm" variant="outline" aria-label="Next" onClick={() => step(1)}>
              <ChevronRightIcon />
            </Button>
            {date !== today && view !== "range" && (
              <Button size="sm" variant="outline" onClick={() => setDate(today)}>
                Today
              </Button>
            )}
          </div>
          <Select aria-label="Author" className="h-7 w-auto min-w-32 text-xs" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="me">Me</option>
            <option value="">Everyone</option>
            {(cfg.data?.authors ?? [])
              .filter((a) => a.id !== me)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
          <div className="relative min-w-48 flex-1 sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search the work log"
              type="search"
              className="h-7 pl-7 text-xs"
              placeholder="Search: ticket: cat: who: date: src: -exclude"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <QuickAdd date={date} categories={categories} quickPicks={cfg.data?.quick_picks ?? []} tickets={ticketOptions} {...(prefill ? { prefill } : {})} />

        <div className="grid min-w-0 gap-3 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-3">
            {!q && me && <SuggestionsPanel date={date} onLog={logSuggestion} />}
            {main}
          </div>
          <div className="min-w-0">
            <TimesheetPanel
              date={date}
              sheets={sheets}
              me={me}
              {...(yesterday.data?.sheets[0] ? { mineYesterday: yesterday.data.sheets[0] } : {})}
              tickets={tickets.data ?? []}
            />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
