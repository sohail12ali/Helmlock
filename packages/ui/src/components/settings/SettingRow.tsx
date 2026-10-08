// One settings row (control-center `.setrow`): the label (12.8px/600) and hint (11.8px muted) on the left, chips, and
// the control on the right. The text has a real flex basis so a wide control wraps to its own line instead of
// squeezing the label; `wide` always puts the control on its own line (grouped controls). Rows are separated by a soft
// rule except the last.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingRow({
  label,
  hint,
  htmlFor,
  chips,
  control,
  wide,
  footer,
  className,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Ties the label to the control. */
  htmlFor?: string;
  chips?: ReactNode;
  control?: ReactNode;
  /** The control takes a whole line under the text. */
  wide?: boolean;
  /** Under the row: status, errors, a nested form. */
  footer?: ReactNode;
  className?: string;
  "data-setting"?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-[11px] gap-y-1.5 border-b border-border/60 px-1 py-[9px] last:border-b-0", className)} {...rest}>
      <div className="min-w-0 flex-[1_1_min(13rem,100%)]">
        <div className="flex flex-wrap items-center gap-1.5">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-[12.8px] font-semibold text-foreground">
              {label}
            </label>
          ) : (
            <span className="text-[12.8px] font-semibold text-foreground">{label}</span>
          )}
          {chips}
        </div>
        {hint && <div className="text-[11.8px] leading-snug text-ink3">{hint}</div>}
      </div>
      {control && <div className={cn("flex min-w-0 flex-wrap items-center gap-[7px]", wide && "flex-[1_1_100%]")}>{control}</div>}
      {footer && <div className="flex min-w-0 flex-[1_1_100%] flex-col gap-1.5">{footer}</div>}
    </div>
  );
}

/** A list of rows. */
export function SettingRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col", className)}>{children}</div>;
}

/** Segmented buttons (control-center `.seg`): one choice of a few, aria-pressed on the chosen one. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="inline-flex overflow-hidden rounded-md border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("border-r px-2.5 py-1 text-xs text-ink2 last:border-r-0 hover:bg-sunk", value === o.value && "bg-accent font-semibold text-primary")}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
