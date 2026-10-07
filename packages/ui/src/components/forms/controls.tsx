// Small form controls the shadcn set here does not have yet: select, switch, textarea, and a labelled field row.
import type * as React from "react";
import { cn } from "@/lib/utils";

const box = "w-full min-w-0 rounded-md border bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(box, "h-8 pr-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(box, "min-h-16 py-1.5", className)} {...props} />;
}

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "on" : "off"}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        checked ? "border-transparent bg-primary" : "bg-sunk",
        className,
      )}
      {...props}
    >
      <span className={cn("inline-block size-3.5 rounded-full bg-card shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

/** Label, required marker, the control, and a hint under it. `htmlFor` ties the label to the control. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink2">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" title="required">
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
