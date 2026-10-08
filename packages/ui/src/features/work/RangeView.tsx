// Month or custom range (control-center paintRange): summary chips and four bar panels, each with a values table twin.
import type { WorkRangeView } from "@helmlock/core/contracts";
import { Bars, Chip, Panel } from "./bits";
import { addDays, fmtH } from "./text";

export function datesOf(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) out.push(d);
  return out;
}

export function RangeSummary({ range, names }: { range: WorkRangeView; names: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="accent" className="font-semibold">
          {fmtH(range.total)} total
        </Chip>
        <Chip>
          {range.days_logged} day{range.days_logged === 1 ? "" : "s"} logged
        </Chip>
        <Chip>{range.files} day files</Chip>
        <Chip>
          {range.start} to {range.end}
        </Chip>
        {range.span_days > 0 && <Chip>span {range.span_days} days</Chip>}
      </div>
      <div className="grid gap-3 @3xl:grid-cols-2">
        <Panel title="Hours by day">
          <Bars label="Hours by day" keyLabel="Day" color="single" sort={false} rows={range.by_day} />
        </Panel>
        <Panel title="Hours by ticket">
          <Bars label="Hours by ticket" keyLabel="Ticket" rows={range.by_ticket} />
        </Panel>
        <Panel title="Hours by category">
          <Bars label="Hours by category" keyLabel="Category" color="category" rows={range.by_category} />
        </Panel>
        <Panel title="Hours by author">
          <Bars label="Hours by author" keyLabel="Author" rows={range.by_author.map((r) => ({ key: names[r.key] ?? r.key, hours: r.hours }))} />
        </Panel>
      </div>
    </div>
  );
}
