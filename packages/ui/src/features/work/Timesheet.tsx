// Timesheet panel: a structured table (ticket, then category, with hours and totals), plus "Copy timesheet" (the lc-wms
// summary text) and "Copy standup" (Yesterday / Today / Blockers from the log, my open tickets and blocked flags).
import type { TicketCard, WorkDaySheet } from "@helmlock/core/contracts";
import { CheckIcon, ClipboardIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Mono, TicketLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { CatDot, Chip, Panel } from "./bits";
import { fmtH, standupText, timesheetText } from "./text";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ label, text }: { label: string; text: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px]"
      onClick={async () => {
        setState((await copy(text())) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? <CheckIcon className="size-3 text-ok" /> : <ClipboardIcon className="size-3" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}

export function TimesheetPanel({
  date,
  sheets,
  me,
  mineYesterday,
  tickets,
}: {
  date: string;
  sheets: WorkDaySheet[];
  me: string | null;
  mineYesterday?: WorkDaySheet;
  tickets: TicketCard[];
}) {
  const mineToday = me ? sheets.find((s) => s.author === me) : undefined;
  return (
    <Panel
      title="Timesheet"
      label="Timesheet"
      right={
        <span className="flex flex-wrap gap-1">
          <CopyButton label="Copy timesheet" text={() => timesheetText(sheets)} />
          {me && (
            <CopyButton
              label="Copy standup"
              text={() =>
                standupText({ date, me, ...(mineToday ? { today: mineToday } : {}), ...(mineYesterday ? { yesterday: mineYesterday } : {}), tickets })
              }
            />
          )}
        </span>
      }
    >
      {!sheets.length && <p className="text-muted-foreground">Nothing logged on {date}.</p>}
      {sheets.map((s) => (
        <div key={s.author} className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={`Timesheet of ${s.name}`}>
            <caption className="pb-1 text-left text-[11px] font-semibold text-ink2">
              {s.name}{" "}
              <span className="font-normal text-muted-foreground">
                {date} · {fmtH(s.total)}
              </span>
            </caption>
            <thead>
              <tr className="border-b text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="py-1 pr-2 font-semibold">Ticket / category</th>
                <th className="py-1 text-right font-semibold">Hours</th>
              </tr>
            </thead>
            <tbody>
              {s.tickets.map((t) => (
                <Fragment key={t.ticket}>
                  <tr className="border-b bg-sunk/40">
                    <th scope="row" className="py-1 pr-2 text-left font-semibold">
                      {/^T-\d/.test(t.ticket) ? <TicketLink id={t.ticket} /> : <Mono>{t.ticket}</Mono>}
                      {t.pinned && (
                        <Chip tone="info" className="ml-1.5">
                          pinned
                        </Chip>
                      )}
                    </th>
                    <td className="py-1 text-right font-semibold tabular-nums">{fmtH(t.hours)}</td>
                  </tr>
                  {t.categories.map((c) => (
                    <tr key={c.category} className="border-b last:border-0">
                      <td className="py-1 pr-2 pl-3">
                        <span className="inline-flex items-center gap-1.5">
                          <CatDot category={c.category} />
                          {c.category}
                        </span>
                        <ul className="mt-0.5 list-disc pl-5 text-[11px] text-ink2">
                          {c.lines.map((l, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: identical lines may repeat
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-1 text-right align-top text-muted-foreground tabular-nums">{fmtH(c.hours)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              {s.internal > 0 && (
                <tr className="text-[11px] text-muted-foreground">
                  <td className="pt-1 pr-2">Billable / internal (on top of the floor)</td>
                  <td className="pt-1 text-right tabular-nums">
                    {fmtH(s.billable)} / {fmtH(s.internal)}
                  </td>
                </tr>
              )}
              <tr className="border-t-2">
                <th scope="row" className="pt-1 pr-2 text-left font-semibold">
                  Total
                </th>
                <td className="pt-1 text-right font-semibold tabular-nums">{fmtH(s.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </Panel>
  );
}
