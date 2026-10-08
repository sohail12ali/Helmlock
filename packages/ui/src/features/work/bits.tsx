// Control-center pieces for the Work page: panels with header and body padding and a full-width divider, pill chips
// with tones, horizontal bars with a "Show values" table twin, a stacked category bar with legend, skeleton and empty.
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { catVar, fmtH, seriesVar } from "./text";

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
  label,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name of the region (defaults to the title when it is text). */
  label?: string;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs", className)}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 pt-2.5 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-[10.5px] font-bold tracking-[0.07em] text-muted-foreground uppercase">{title}</h2>
        {right}
      </header>
      <div className={cn("flex min-w-0 flex-col gap-2.5 px-3 pt-2.5 pb-3 text-xs", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "default" | "accent" | "ok" | "warn" | "danger" | "info";
const TONE: Record<Tone, string> = {
  default: "border-border bg-sunk text-ink2",
  accent: "border-primary/30 bg-accent text-primary",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/25 bg-primary/5 text-primary",
};

export function Chip({ tone = "default", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full border px-[7px] py-px text-[11px] whitespace-nowrap", TONE[tone], className)}
    >
      {children}
    </span>
  );
}

export function CatDot({ category, className }: { category: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-[9px] shrink-0 rounded-[2px]", className)} style={{ background: catVar(category) }} />;
}

/** Horizontal bars (DOM, themeable, accessible) with a "Show values" table twin. */
export function Bars({
  rows,
  keyLabel,
  color = "series",
  label,
  sort = true,
  format = fmtH,
}: {
  rows: { key: string; hours: number }[];
  keyLabel: string;
  color?: "series" | "category" | "single";
  label: string;
  sort?: boolean;
  format?: (n: number) => string;
}) {
  const [values, setValues] = useState(false);
  const list = sort ? [...rows].sort((a, b) => b.hours - a.hours) : rows;
  const max = Math.max(0, ...list.map((r) => r.hours)) || 1;
  if (!list.length) return <p className="text-muted-foreground">Nothing in this range.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-[5px]" aria-label={label}>
        {list.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[minmax(72px,26%)_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-ink2" title={r.key}>
              {r.key}
            </span>
            <span className="h-[9px] overflow-hidden rounded-full bg-sunk">
              <span
                className="block h-full rounded-full transition-[width]"
                style={{
                  width: `${(r.hours / max) * 100}%`,
                  background: color === "category" ? catVar(r.key) : color === "single" ? "var(--cat-1)" : seriesVar(i),
                }}
              />
            </span>
            <span className="min-w-[34px] text-right text-muted-foreground tabular-nums">{format(r.hours)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="self-start text-[11px] text-primary hover:underline" aria-expanded={values} onClick={() => setValues(!values)}>
        {values ? "Hide values" : "Show values"}
      </button>
      {values && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={`${label} values`}>
            <thead>
              <tr className="border-b text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="py-1 pr-2 font-semibold">{keyLabel}</th>
                <th className="py-1 text-right font-semibold">Hours</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-1 pr-2">{r.key}</td>
                  <td className="py-1 text-right tabular-nums">{Number(r.hours.toFixed(2))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The shape of a day in one line: a stacked category bar and its legend. */
export function CategoryStack({ parts }: { parts: { category: string; hours: number }[] }) {
  const total = parts.reduce((s, p) => s + p.hours, 0);
  if (!total) return null;
  return (
    <div>
      <div className="flex h-[22px] overflow-hidden rounded-sm bg-sunk" role="img" aria-label={parts.map((p) => `${p.category} ${fmtH(p.hours)}`).join(", ")}>
        {parts.map((p) => (
          <span
            key={p.category}
            className="flex min-w-0 items-center justify-center overflow-hidden text-[10.5px] font-semibold text-white"
            style={{ flexBasis: `${(p.hours / total) * 100}%`, background: catVar(p.category) }}
          >
            {p.hours / total > 0.12 ? fmtH(p.hours) : ""}
          </span>
        ))}
      </div>
      <div className="mt-[7px] flex flex-wrap gap-x-2.5 gap-y-1">
        {parts.map((p) => (
          <span key={p.category} className="inline-flex items-center gap-[5px] text-[11px] text-ink2">
            <CatDot category={p.category} />
            {p.category} {fmtH(p.hours)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
        <div key={i} className="h-4 animate-live rounded bg-sunk" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center text-muted-foreground">
      <Icon className="size-6 opacity-50" aria-hidden />
      <p className="text-[13px] font-semibold text-ink2">{title}</p>
      {hint && <p className="max-w-[42ch] text-xs">{hint}</p>}
      {children}
    </div>
  );
}

/** Segmented control (control-center .seg). */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <fieldset className="inline-flex min-w-0 overflow-hidden rounded-md border bg-card">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "border-r px-2.5 py-1 text-xs text-ink2 last:border-r-0 hover:bg-sunk hover:text-foreground",
            value === o.id && "bg-accent font-semibold text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
