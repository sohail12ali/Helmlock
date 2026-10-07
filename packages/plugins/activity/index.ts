// Activity: the audit trail of verb calls, one JSONL per person per day (F70, Blueprint 24 #10).
// activity/YYYY-MM/DD.<author>.jsonl where author is the person accountable (on_behalf_of).
import type { ActivityService, Context, PluginModule } from "@helmlock/core";
import { ActivityLine } from "@helmlock/core";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function activityPath(date: string, author: string): string {
  const m = DATE.exec(date);
  if (!m) throw new Error(`not a date (expected YYYY-MM-DD): ${date}`);
  return `activity/${m[1]}-${m[2]}/${m[3]}.${author}.jsonl`;
}

/** The person's own calendar day for a timestamp (the machine's local time zone). */
export function localDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createActivity(ctx: Context): ActivityService {
  const files = ctx.get("files");
  return {
    async append(line) {
      const row = ActivityLine.parse({ ...line, ts: line.ts ?? new Date().toISOString() });
      await files.appendJsonl(activityPath(localDate(row.ts), row.on_behalf_of), row);
    },
    async read(date, author) {
      const rel = activityPath(date, author ?? "x");
      if (author) return files.readJsonl(rel, ActivityLine);
      const dir = rel.slice(0, rel.lastIndexOf("/"));
      const day = date.slice(8, 10);
      const out: ActivityLine[] = [];
      for (const f of await files.list(`${dir}/${day}.*.jsonl`)) out.push(...(await files.readJsonl(f, ActivityLine)));
      return out.sort((a, b) => a.ts.localeCompare(b.ts));
    },
  };
}

const plugin: PluginModule = {
  name: "activity",
  requires: ["files"],
  apply(ctx) {
    ctx.provide("activity", createActivity(ctx));
  },
};

export default plugin;
