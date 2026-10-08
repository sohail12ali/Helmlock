// A small status chip (control-center `.chip`): pill, 11px, a tint per tone. Used on settings rows for the scope,
// "changed", "when it applies" and lock marks, and anywhere a page wants the same quiet label.
import type * as React from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

const TONE: Record<ChipTone, string> = {
  neutral: "border-border bg-sunk text-ink2",
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  danger: "border-destructive/35 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-accent text-primary",
  accent: "border-primary/30 bg-accent text-primary",
};

export function Chip({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span
      data-slot="chip"
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-[7px] py-px text-[11px] leading-4 font-medium whitespace-nowrap [&>svg]:size-3",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
