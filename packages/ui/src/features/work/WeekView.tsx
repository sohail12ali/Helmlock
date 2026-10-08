// Week view: a grid of hours per cell. Everyone: people x Mon-Sun. One person: tickets x Mon-Sun. Day totals at the
// bottom; a weekday up to today with nothing logged is a gap; a cell opens that day.
import type { WorkRangeView } from "@helmlock/core/contracts";
import { cn } from "@/lib/utils";
import { datesOf } from "./RangeView";
import { fmtH, isWeekend, weekdayShort } from "./text";

export function WeekGrid({
  range,
  mode,
  today,
  names,
  onOpen,
}: {
  range: WorkRangeView;
  /** "people": a row per author; "tickets": a row per ticket of one person. */
  mode: "people" | "tickets";
  today: string;
  names: Record<string, string>;
  onOpen: (date: string, author?: string) => void;
}) {
  const days = datesOf(range.start, range.end);
  const rows =
    mode === "people"
      ? [...new Set([...range.days.map((d) => d.author), ...(range.author ? [range.author] : [])])].sort((a, b) => (names[a] ?? a).localeCompare(names[b] ?? b))
      : [...new Set(range.cells.map((c) => c.ticket))].sort();
  const cell = (row: string, date: string) =>
    mode === "people"
      ? range.days.find((d) => d.author === row && d.date === date)?.total
      : range.cells.filter((c) => c.ticket === row && c.date === date).reduce((s, c) => s + c.hours, 0) || undefined;
  const dayTotal = (date: string) => range.days.filter((d) => d.date === date).reduce((s, d) => s + d.total, 0);
  const gap = (date: string, hours: number | undefined) => !hours && !isWeekend(date) && date <= today;
  const authorFor = (row: string) => (mode === "people" ? row : (range.author ?? undefined));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-xs" aria-label="Week grid">
        <thead>
          <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="py-1.5 pr-2 text-left font-semibold">{mode === "people" ? "Person" : "Ticket"}</th>
            {days.map((d) => (
              <th key={d} className={cn("px-1 py-1.5 text-right font-semibold", d === today && "text-primary")}>
                {weekdayShort(d)} <span className="font-normal normal-case">{d.slice(8)}</span>
              </th>
            ))}
            <th className="py-1.5 pl-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = days.reduce((s, d) => s + (cell(row, d) ?? 0), 0);
            return (
              <tr key={row} className="border-t">
                <th scope="row" className="max-w-40 truncate py-1 pr-2 text-left font-medium" title={row}>
                  {mode === "people" ? (names[row] ?? row) : <span className="font-mono">{row}</span>}
                </th>
                {days.map((d) => {
                  const h = cell(row, d);
                  const isGap = mode === "people" && gap(d, h);
                  return (
                    <td key={d} className="p-0.5 text-right">
                      <button
                        type="button"
                        onClick={() => onOpen(d, authorFor(row))}
                        aria-label={`${mode === "people" ? (names[row] ?? row) : row} on ${d}: ${h ? fmtH(h) : isGap ? "gap, nothing logged" : "nothing"}`}
                        data-gap={isGap || undefined}
                        className={cn(
                          "w-full rounded px-1.5 py-1 text-right tabular-nums hover:bg-accent",
                          h ? "text-foreground" : "text-muted-foreground/60",
                          isGap && "border border-dashed border-warn/50 bg-warn/10 text-warn",
                          isWeekend(d) && !h && "bg-sunk/40",
                        )}
                      >
                        {h ? fmtH(h) : isGap ? "gap" : "·"}
                      </button>
                    </td>
                  );
                })}
                <td className="py-1 pl-2 text-right font-semibold tabular-nums">{fmtH(total)}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={days.length + 2} className="py-4 text-center text-muted-foreground">
                Nothing logged this week.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 text-[11px]">
            <th scope="row" className="py-1.5 pr-2 text-left font-semibold text-muted-foreground uppercase">
              Day total
            </th>
            {days.map((d) => {
              const t = dayTotal(d);
              const isGap = mode === "tickets" && gap(d, t);
              return (
                <td
                  key={d}
                  data-gap={isGap || undefined}
                  className={cn("px-1.5 py-1.5 text-right tabular-nums", !t && "text-muted-foreground/60", isGap && "bg-warn/10 text-warn")}
                >
                  {t ? fmtH(t) : isGap ? "gap" : "·"}
                </td>
              );
            })}
            <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{fmtH(range.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
