// Day view: one card per author (control-center sheet panel). Header: name, total, day length with overtime /
// shortfall / not-stated chips and "Check activity" (evidence suggests a length; Apply writes it). Body: the stacked
// category bar, category headings, ticket rows with hours (pinned or allocated) and each line with its source,
// inline Edit and Delete (your own lines only; confirm inside the page).
import type { WorkDaySheet, WorkEntryView } from "@helmlock/core/contracts";
import { ActivityIcon, ClockIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useWorkEvidence } from "@/api/work";
import { INVALIDATE } from "@/api/write-hooks";
import { Mono, TicketLink } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CatDot, CategoryStack, Chip, Panel } from "./bits";
import { fmtH, MAX_TEXT, textProblem } from "./text";

const isTicket = (t: string) => /^T-\d/.test(t);

function SourceChip({ source }: { source?: string }) {
  if (!source || source === "manual") return null;
  const run = /^agent-run:(.+)$/.exec(source)?.[1];
  return run ? (
    <Link
      to={`/runs/${encodeURIComponent(run)}`}
      className="shrink-0 rounded-full border bg-sunk px-[7px] py-px text-[11px] text-ink2 hover:border-primary hover:text-primary"
    >
      run {run.length > 14 ? `${run.slice(0, 14)}…` : run}
    </Link>
  ) : (
    <Chip>{source}</Chip>
  );
}

function EditEntry({ sheet, entry, categories, onDone }: { sheet: WorkDaySheet; entry: WorkEntryView; categories: string[]; onDone: () => void }) {
  const uid = useId();
  const [ticket, setTicket] = useState(entry.ticket);
  const [text, setText] = useState(entry.text);
  const [category, setCategory] = useState(entry.category);
  const [mode, setMode] = useState<"weight" | "hours">(entry.pinned ? "hours" : "weight");
  const [weight, setWeight] = useState(String(entry.weight ?? 3));
  const [hours, setHours] = useState(String(entry.hours ?? entry.hours_alloc));
  const v = useVerbRun("log edit", INVALIDATE.worklog);
  const problem = textProblem(text);
  const save = async () => {
    const input: Record<string, unknown> = { date: sheet.date, entry: entry.id, hash: sheet.hash };
    if (ticket.trim() !== entry.ticket) input.ticket = ticket.trim();
    if (text.trim() !== entry.text) input.text = text.trim();
    if (category !== entry.category) input.category = category;
    if (mode === "weight" && (entry.pinned || Number(weight) !== entry.weight)) input.weight = Number(weight);
    if (mode === "hours" && (!entry.pinned || Number(hours) !== entry.hours)) input.hours = Number(hours);
    if (Object.keys(input).length === 3) return onDone();
    const r = await v.run(input);
    if (r.ok) onDone();
  };
  return (
    <form
      aria-label="Edit entry"
      className="flex flex-col gap-2 rounded-md border bg-sunk/50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <Input aria-label="Edit ticket" className="h-7 font-mono text-xs" value={ticket} onChange={(e) => setTicket(e.target.value)} />
        <Input
          aria-label="Edit text"
          aria-invalid={problem ? true : undefined}
          className="h-7 text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {problem && (
        <p role="alert" className="text-[11px] text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Edit category" className="h-7 w-36 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
          {[...new Set([...categories, entry.category])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Edit time"
          id={`${uid}-mode`}
          className="h-7 w-32 text-xs"
          value={mode}
          onChange={(e) => setMode(e.target.value as "weight" | "hours")}
        >
          <option value="weight">Share of day</option>
          <option value="hours">Fixed hours</option>
        </Select>
        {mode === "weight" ? (
          <Select aria-label="Edit weight" className="h-7 w-16 text-xs" value={weight} onChange={(e) => setWeight(e.target.value)}>
            {[1, 2, 3, 4, 5].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            aria-label="Edit hours"
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            className="h-7 w-20 text-xs"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        )}
        <span className="text-[11px] text-muted-foreground">
          {text.trim().length}/{MAX_TEXT}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!!problem || !text.trim() || v.pending}>
            Save
          </Button>
        </div>
      </div>
      <VerbResult result={v.last?.result && !v.last.result.ok ? v.last.result : undefined} />
    </form>
  );
}

function EntryLine({ sheet, entry, mine, categories }: { sheet: WorkDaySheet; entry: WorkEntryView; mine: boolean; categories: string[] }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rm = useVerbRun("log remove", INVALIDATE.worklog);
  if (editing) return <EditEntry sheet={sheet} entry={entry} categories={categories} onDone={() => setEditing(false)} />;
  return (
    <div className="group flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words">{entry.text}</span>
        {entry.pinned && <Chip tone="info">{fmtH(entry.hours ?? entry.hours_alloc)} pinned</Chip>}
        {!entry.pinned && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={`weight ${entry.weight ?? 3}`}>
            {fmtH(entry.hours_alloc)}
          </span>
        )}
        <SourceChip source={entry.source} />
        {mine && !confirm && (
          <span className="flex shrink-0 gap-0.5">
            <Button size="icon-sm" variant="ghost" className="size-6" aria-label={`Edit: ${entry.text}`} onClick={() => setEditing(true)}>
              <PencilIcon className="size-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" className="size-6" aria-label={`Delete: ${entry.text}`} onClick={() => setConfirm(true)}>
              <Trash2Icon className="size-3.5" />
            </Button>
          </span>
        )}
      </div>
      {confirm && (
        <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1">
          <legend className="sr-only">Confirm delete</legend>
          <span className="text-[11px] text-ink2">Remove this line from {sheet.date}?</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 border-destructive/40 text-destructive"
            disabled={rm.pending}
            onClick={async () => {
              const r = await rm.run({ date: sheet.date, entry: entry.id, hash: sheet.hash });
              if (r.ok) setConfirm(false);
            }}
          >
            Remove
          </Button>
          <Button size="sm" variant="ghost" className="h-6" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </fieldset>
      )}
      {rm.last && !rm.last.result.ok && <VerbResult result={rm.last.result} />}
    </div>
  );
}

interface LengthState {
  open: boolean;
  setOpen: (v: boolean) => void;
  check: boolean;
  setCheck: (v: boolean) => void;
}

function DayLengthChips({ sheet, mine, st }: { sheet: WorkDaySheet; mine: boolean; st: LengthState }) {
  const { open, setOpen, check, setCheck } = st;
  return (
    <>
      {sheet.day_hours !== undefined ? (
        <Chip title="Stated day length">day {fmtH(sheet.day_hours)}</Chip>
      ) : (
        <Chip className="opacity-70" title={`No day length stated: the ${fmtH(sheet.floor)} floor applies`}>
          not stated
        </Chip>
      )}
      {sheet.overtime > 0 && <Chip tone="warn">overtime {fmtH(sheet.overtime)}</Chip>}
      {sheet.shortfall > 0 && <Chip tone="danger">short {fmtH(sheet.shortfall)}</Chip>}
      {sheet.inferred_length && (
        <Chip tone="warn" title="Pinned hours fill the day, so the other lines carry a placeholder">
          length unknown
        </Chip>
      )}
      {mine && (
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ClockIcon className="size-3" />
          Day length
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" aria-expanded={check} onClick={() => setCheck(!check)}>
        <ActivityIcon className="size-3" />
        Check activity
      </Button>
    </>
  );
}

function DayLengthPanel({ sheet, mine, st }: { sheet: WorkDaySheet; mine: boolean; st: LengthState }) {
  const { open, setOpen, check, setCheck } = st;
  const [value, setValue] = useState(String(sheet.day_hours ?? sheet.floor));
  const v = useVerbRun("log day-hours", INVALIDATE.worklog);
  const ev = useWorkEvidence(sheet.date, sheet.author, check);
  const set = async (hours: number) => {
    const r = await v.run({ date: sheet.date, hours, hash: sheet.hash });
    if (r.ok) {
      setOpen(false);
      setCheck(false);
    }
  };
  if (!open && !check) return null;
  return (
    <div>
      {open && (
        <form
          aria-label="Day length"
          className="mt-1 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void set(Number(value));
          }}
        >
          <Input
            aria-label="Day length (hours)"
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            className="h-7 w-20 text-xs"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={v.pending || !(Number(value) > 0)}>
            Save
          </Button>
          {sheet.day_hours !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => void set(0)}>
              Back to the floor
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground">A floor, not a cap: a longer day shows as overtime.</span>
        </form>
      )}
      {check && (
        <section className="mt-1 rounded-md border bg-sunk/50 p-2 text-[11px]" aria-label="Activity evidence">
          {ev.isPending ? (
            <span className="text-muted-foreground">Reading commits and runs…</span>
          ) : ev.isError ? (
            <span className="text-destructive">{(ev.error as Error).message}</span>
          ) : ev.data ? (
            <div className="flex flex-col gap-1">
              <ul className="list-disc pl-4 text-ink2">
                {ev.data.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {ev.data.suggested !== undefined && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Suggested day length <strong>{fmtH(ev.data.suggested)}</strong>
                  </span>
                  {mine && ev.data.suggested !== sheet.day_hours && (
                    <Button size="sm" className="h-6" disabled={v.pending} onClick={() => void set(ev.data!.suggested!)}>
                      Apply {fmtH(ev.data.suggested)}
                    </Button>
                  )}
                </div>
              )}
              <span className="text-muted-foreground">{ev.data.caveat}</span>
            </div>
          ) : null}
        </section>
      )}
      {v.last && <VerbResult className="mt-1" result={v.last.result} />}
    </div>
  );
}

export function AuthorCard({ sheet, mine, categories }: { sheet: WorkDaySheet; mine: boolean; categories: string[] }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState(false);
  const st: LengthState = { open, setOpen, check, setCheck };
  // Category headings, then ticket rows inside each (control-center by_category -> tickets).
  const byCat = new Map<string, Map<string, WorkEntryView[]>>();
  for (const e of sheet.entries) {
    const t = byCat.get(e.category) ?? new Map<string, WorkEntryView[]>();
    t.set(e.ticket, [...(t.get(e.ticket) ?? []), e]);
    byCat.set(e.category, t);
  }
  const order = sheet.categories.map((c) => c.category);
  return (
    <Panel
      label={`${sheet.name} on ${sheet.date}`}
      title={sheet.name}
      right={
        <span className="flex flex-wrap items-center gap-1">
          <Chip tone="accent" className="font-semibold">
            {fmtH(sheet.total)}
          </Chip>
          {sheet.internal > 0 && <Chip title="Internal is counted on top of the floor">internal {fmtH(sheet.internal)}</Chip>}
          <DayLengthChips sheet={sheet} mine={mine} st={st} />
        </span>
      }
    >
      <DayLengthPanel sheet={sheet} mine={mine} st={st} />
      <CategoryStack parts={sheet.categories} />
      {order.map((cat) => {
        const tickets = byCat.get(cat);
        if (!tickets) return null;
        const catHours = sheet.categories.find((c) => c.category === cat)?.hours ?? 0;
        return (
          <div key={cat} className="flex flex-col">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
              <CatDot category={cat} />
              {cat} <span className="font-normal text-muted-foreground">{fmtH(catHours)}</span>
            </h3>
            <div className="flex flex-col">
              {[...tickets.entries()].map(([ticket, entries]) => {
                const hours = entries.reduce((s, e) => s + e.hours_alloc, 0);
                const pinned = entries.some((e) => e.pinned);
                return (
                  <div key={ticket} className="flex min-w-0 items-start gap-2 border-b py-1.5 last:border-0">
                    <span className="flex w-24 shrink-0 flex-col items-start gap-1">
                      <Chip tone={pinned ? "info" : "default"} title={pinned ? "Includes pinned hours" : "Allocated by weight"}>
                        {fmtH(hours)}
                        <span className="text-[10px] opacity-70">{pinned ? "pin" : "alloc"}</span>
                      </Chip>
                      {isTicket(ticket) ? (
                        <TicketLink id={ticket} className="text-[11px]" />
                      ) : (
                        <Mono className="text-[11px] text-muted-foreground">{ticket}</Mono>
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {entries.map((e) => (
                        <EntryLine key={e.id} sheet={sheet} entry={e} mine={mine} categories={categories} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!sheet.entries.length && <p className="text-muted-foreground">Only a day length is stated for this day.</p>}
      <p className={cn("text-[11px] text-muted-foreground")}>
        <Mono>{sheet.file}</Mono>
      </p>
    </Panel>
  );
}
