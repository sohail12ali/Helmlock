// Today's logged hours on the Work nav item (control-center nav badge).
import { useWorkDay } from "@/api/work";
import { fmtH, iso } from "./text";

export function WorkNavBadge() {
  const q = useWorkDay(iso(new Date()), "me");
  const total = (q.data?.sheets ?? []).reduce((s, x) => s + x.total, 0);
  if (!total) return null;
  return (
    <span className="ml-auto rounded-full bg-sunk px-1.5 font-mono text-[11px] text-ink2" title="Logged today" data-testid="work-badge">
      {fmtH(total)}
    </span>
  );
}
