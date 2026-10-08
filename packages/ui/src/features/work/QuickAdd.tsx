// Quick add (always visible): ticket picker with recent and open tickets plus the configured quick picks, one sentence
// with live validation (the verb's own rules), category chips, weight 1-5 or pinned hours, and the date. Writes through
// `log-work`; a skipped duplicate is a normal result.
import type { WorkQuickPick } from "@helmlock/core/contracts";
import { XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { INVALIDATE } from "@/api/write-hooks";
import { Mono } from "@/components/common";
import { Field } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CatDot } from "./bits";
import { MAX_TEXT, textProblem } from "./text";

export interface Prefill {
  ticket?: string;
  text?: string;
  category?: string;
  hours?: number;
  source?: string;
}

export function QuickAdd({
  date,
  categories,
  quickPicks,
  tickets,
  prefill,
}: {
  date: string;
  categories: string[];
  quickPicks: WorkQuickPick[];
  /** Ticket ids to offer: recent first, then open ones. */
  tickets: { id: string; title?: string }[];
  /** A suggestion's draft; a new object replaces the form's ticket, text and source. */
  prefill?: Prefill;
}) {
  const uid = useId();
  const [ticket, setTicket] = useState("-");
  const [text, setText] = useState("");
  const [category, setCategory] = useState(categories.includes("Development") ? "Development" : (categories[0] ?? "Development"));
  const [mode, setMode] = useState<"weight" | "hours">("weight");
  const [weight, setWeight] = useState(3);
  const [hours, setHours] = useState("");
  const [day, setDay] = useState(date);
  const [source, setSource] = useState<string>();
  const v = useVerbRun("log-work", INVALIDATE.worklog);

  useEffect(() => setDay(date), [date]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new prefill object is the only trigger
  useEffect(() => {
    if (!prefill) return;
    if (prefill.ticket) setTicket(prefill.ticket);
    setText(prefill.text ?? "");
    if (prefill.category) setCategory(prefill.category);
    if (prefill.hours !== undefined) {
      setMode("hours");
      setHours(String(prefill.hours));
    }
    setSource(prefill.source);
    v.clear();
  }, [prefill]);

  const clean = text.trim();
  const len = clean.length;
  const problem = textProblem(text);
  const hoursOk = mode === "weight" || (Number(hours) >= 0.25 && Number(hours) <= 24);
  const ready = len > 0 && !problem && ticket.trim() !== "" && !/\s/.test(ticket.trim()) && hoursOk;

  const pick = (p: WorkQuickPick) => {
    setTicket(p.ticket);
    if (categories.includes(p.category)) setCategory(p.category);
    if (p.hours !== undefined) {
      setMode("hours");
      setHours(String(p.hours));
    }
    if (!clean) setText(p.label);
  };

  const send = async (dryRun: boolean) => {
    const input: Record<string, unknown> = { ticket: ticket.trim() || "-", text: clean, category };
    if (mode === "weight") input.weight = weight;
    else input.hours = Number(hours);
    if (day) input.date = day;
    if (source) input.source = source;
    const r = await v.run(input, dryRun);
    if (!dryRun && r.ok && (r.data as { written?: boolean } | undefined)?.written !== false) {
      setText("");
      setSource(undefined);
    }
  };

  return (
    <form
      aria-label="Log work"
      className="flex min-w-0 flex-col gap-2.5 rounded-lg border bg-card p-3 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void send(false);
      }}
    >
      {quickPicks.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Quick picks</legend>
          <span className="text-[11px] text-muted-foreground">Quick pick</span>
          {quickPicks.map((p) => (
            <Button key={p.label} size="sm" variant="outline" className="h-6 rounded-full px-2.5 text-[11px]" onClick={() => pick(p)}>
              {p.label}
              {p.hours !== undefined && <span className="text-muted-foreground">{p.hours}h</span>}
            </Button>
          ))}
        </fieldset>
      )}
      <div className="grid min-w-0 gap-2 sm:grid-cols-[10rem_1fr_9.5rem]">
        <Field label="Ticket" htmlFor={`${uid}-ticket`} required>
          <Input id={`${uid}-ticket`} list={`${uid}-tickets`} className="h-8 font-mono" value={ticket} onChange={(e) => setTicket(e.target.value)} />
          <datalist id={`${uid}-tickets`}>
            <option value="-">no ticket</option>
            {tickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title ?? ""}
              </option>
            ))}
          </datalist>
        </Field>
        <Field
          label="What did you do"
          htmlFor={`${uid}-text`}
          required
          hint={
            <span className="flex flex-wrap justify-between gap-2">
              <span className={cn(problem && "text-destructive")} role={problem ? "alert" : undefined}>
                {problem ?? "One plain sentence. No agent or tool names; the tool owns author, dedupe and hours."}
              </span>
              <span aria-live="polite" data-testid="text-counter" className={cn("font-mono", len > MAX_TEXT && "font-medium text-destructive")}>
                {len}/{MAX_TEXT}
              </span>
            </span>
          }
        >
          <Input
            id={`${uid}-text`}
            className="h-8"
            value={text}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            placeholder="Chose TOML for records and wrote the format map"
          />
        </Field>
        <Field label="Date" htmlFor={`${uid}-date`}>
          <Input id={`${uid}-date`} type="date" className="h-8" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Category</legend>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] text-ink2 hover:bg-sunk",
                category === c && "border-primary/40 bg-accent font-semibold text-foreground",
              )}
            >
              <CatDot category={c} />
              {c}
            </button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-1.5">
          <fieldset className="inline-flex overflow-hidden rounded-md border">
            <legend className="sr-only">Time</legend>
            <button
              type="button"
              aria-pressed={mode === "weight"}
              onClick={() => setMode("weight")}
              className={cn("px-2 py-0.5 text-[11px] text-ink2", mode === "weight" && "bg-accent font-semibold text-primary")}
            >
              Share of day
            </button>
            <button
              type="button"
              aria-pressed={mode === "hours"}
              onClick={() => setMode("hours")}
              className={cn("border-l px-2 py-0.5 text-[11px] text-ink2", mode === "hours" && "bg-accent font-semibold text-primary")}
            >
              Fixed hours
            </button>
          </fieldset>
          {mode === "weight" ? (
            <fieldset className="inline-flex overflow-hidden rounded-md border">
              <legend className="sr-only">Weight</legend>
              {[1, 2, 3, 4, 5].map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={weight === w}
                  aria-label={`Weight ${w}`}
                  onClick={() => setWeight(w)}
                  className={cn(
                    "w-6 border-r py-0.5 text-[11px] last:border-r-0",
                    weight === w ? "bg-primary text-primary-foreground" : "text-ink2 hover:bg-sunk",
                  )}
                >
                  {w}
                </button>
              ))}
            </fieldset>
          ) : (
            <Input
              aria-label="Hours"
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              className="h-7 w-20"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          )}
        </div>
        {source && (
          <span className="inline-flex items-center gap-1 rounded-full border bg-sunk px-2 py-px text-[11px] text-ink2">
            from <Mono>{source}</Mono>
            <button type="button" aria-label="Drop the source" onClick={() => setSource(undefined)} className="hover:text-foreground">
              <XIcon className="size-3" />
            </button>
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" disabled={!ready || v.pending} onClick={() => void send(true)}>
            Preview
          </Button>
          <Button size="sm" type="submit" disabled={!ready || v.pending}>
            Log
          </Button>
        </div>
      </div>
      <VerbResult result={v.last?.result} preview={v.last?.preview} />
    </form>
  );
}
