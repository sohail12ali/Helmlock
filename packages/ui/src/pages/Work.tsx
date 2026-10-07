// Work log (F6b, F93, Blueprint 14): today and this week with allocated hours, and a quick add through `log-work`.
// One plain sentence; the tool owns author, file, dedupe and hours. A skipped duplicate is a normal result.
import type { WorkLogLine } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "@/api/client";
import { keys } from "@/api/hooks";
import { INVALIDATE } from "@/api/write-hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader, TicketLink } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isoLocal, weekStart } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const MAX_TEXT = 160;
export const CATEGORIES = ["Development", "Code Review", "Testing", "Design", "Documentation", "Internal"] as const;
const fmtH = (h: number) => `${Number(h.toFixed(2))}h`;

function LogForm() {
  const uid = useId();
  const [ticket, setTicket] = useState("-");
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("Development");
  const [mode, setMode] = useState<"weight" | "hours">("weight");
  const [weight, setWeight] = useState("3");
  const [hours, setHours] = useState("");
  const v = useVerbRun("log-work", INVALIDATE.worklog);
  const len = text.trim().length;
  const over = len > MAX_TEXT;
  const ready = len > 0 && !over && ticket.trim() !== "" && (mode === "weight" || Number(hours) > 0);

  const send = async (dryRun: boolean) => {
    const input: Record<string, unknown> = { ticket: ticket.trim() || "-", text: text.trim(), category };
    if (mode === "weight") input.weight = Number(weight);
    else input.hours = Number(hours);
    const r = await v.run(input, dryRun);
    if (!dryRun && r.ok) {
      const d = r.data as { written?: boolean } | undefined;
      if (d?.written !== false) setText("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log work</CardTitle>
        <span className="text-xs text-muted-foreground">one plain sentence for the timesheet</span>
      </CardHeader>
      <CardContent>
        <form
          aria-label="Log work"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void send(false);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
            <Field label="Ticket" htmlFor={`${uid}-ticket`} required hint='a ticket id, a special key such as Internal, or "-"'>
              <Input id={`${uid}-ticket`} className="font-mono" value={ticket} onChange={(e) => setTicket(e.target.value)} />
            </Field>
            <Field
              label="What did you do"
              htmlFor={`${uid}-text`}
              required
              hint={
                <span className="flex flex-wrap justify-between gap-2">
                  <span>No agent or skill names. The tool owns author and dedupe.</span>
                  <span aria-live="polite" data-testid="text-counter" className={cn("font-mono", over && "font-medium text-destructive")}>
                    {len}/{MAX_TEXT}
                  </span>
                </span>
              }
            >
              <Input
                id={`${uid}-text`}
                value={text}
                aria-invalid={over || undefined}
                onChange={(e) => setText(e.target.value)}
                placeholder="Chose TOML for records and wrote the format map"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Category" htmlFor={`${uid}-category`} className="w-40">
              <Select id={`${uid}-category`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs font-medium text-ink2">Time</legend>
              <div className="flex gap-1">
                <Button size="sm" variant={mode === "weight" ? "secondary" : "outline"} aria-pressed={mode === "weight"} onClick={() => setMode("weight")}>
                  Share of day
                </Button>
                <Button size="sm" variant={mode === "hours" ? "secondary" : "outline"} aria-pressed={mode === "hours"} onClick={() => setMode("hours")}>
                  Fixed hours
                </Button>
              </div>
            </fieldset>
            {mode === "weight" ? (
              <Field label="Weight (1 to 5)" htmlFor={`${uid}-weight`} className="w-28">
                <Select id={`${uid}-weight`} value={weight} onChange={(e) => setWeight(e.target.value)}>
                  {[1, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Hours" htmlFor={`${uid}-hours`} className="w-28">
                <Input id={`${uid}-hours`} type="number" min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />
              </Field>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="default" variant="outline" disabled={!ready || v.pending} onClick={() => void send(true)}>
                Preview
              </Button>
              <Button type="submit" disabled={!ready || v.pending}>
                Log
              </Button>
            </div>
          </div>
          {over && (
            <p className="text-xs text-destructive" role="alert">
              Shorten to {MAX_TEXT} characters: one plain sentence.
            </p>
          )}
          <VerbResult result={v.last?.result} preview={v.last?.preview} />
        </form>
      </CardContent>
    </Card>
  );
}

function LogTable({ rows, label, showDate }: { rows: WorkLogLine[]; label: string; showDate?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            {showDate && <th className="py-1.5 pr-3 font-medium">Date</th>}
            <th className="py-1.5 pr-3 font-medium">Author</th>
            <th className="py-1.5 pr-3 font-medium">Ticket</th>
            <th className="py-1.5 pr-3 font-medium">Category</th>
            <th className="py-1.5 pr-3 font-medium">Work</th>
            <th className="py-1.5 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={`${w.date}-${w.author}-${w.ticket}-${w.text}`} className="border-b last:border-0">
              {showDate && (
                <td className="py-1.5 pr-3">
                  <Mono>{w.date}</Mono>
                </td>
              )}
              <td className="py-1.5 pr-3">
                <Mono>{w.author}</Mono>
              </td>
              <td className="py-1.5 pr-3">{/^T-/.test(w.ticket) ? <TicketLink id={w.ticket} /> : <Mono>{w.ticket}</Mono>}</td>
              <td className="py-1.5 pr-3">{w.category}</td>
              <td className="py-1.5 pr-3">{w.text}</td>
              <td className="py-1.5 text-right">
                <Mono>{fmtH(w.hours_alloc)}</Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkPage() {
  const from = weekStart();
  const today = isoLocal(new Date());
  const q = useQuery({ queryKey: keys.worklog({ from }), queryFn: ({ signal }) => api.worklog({ from }, signal) });
  const rows = q.data ?? [];
  const todays = rows.filter((w) => w.date === today);
  const earlier = rows.filter((w) => w.date !== today).sort((a, b) => b.date.localeCompare(a.date));
  const sum = (xs: WorkLogLine[]) => xs.reduce((n, w) => n + w.hours_alloc, 0);
  return (
    <PageLayout id="work">
      <PageHeader title="Work">
        <span className="text-xs text-muted-foreground">
          week from <Mono>{from}</Mono> · <Mono>{fmtH(sum(rows))}</Mono>
        </span>
      </PageHeader>
      <div className="grid w-full gap-3">
        <LogForm />
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Today</CardTitle>
                <Mono className="text-xs text-muted-foreground">{fmtH(sum(todays))}</Mono>
              </CardHeader>
              <CardContent>
                {todays.length === 0 ? (
                  <EmptyState title="Nothing logged today." hint="Log one sentence above when you finish a piece of work." />
                ) : (
                  <LogTable rows={todays} label="Today's work log" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Earlier this week</CardTitle>
                <Mono className="text-xs text-muted-foreground">{fmtH(sum(earlier))}</Mono>
              </CardHeader>
              <CardContent>
                {earlier.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No earlier entries this week.</p>
                ) : (
                  <LogTable rows={earlier} label="This week's work log" showDate />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
