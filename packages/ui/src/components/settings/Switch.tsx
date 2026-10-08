// A real switch (control-center `.switch`): a 38x21 pill, accent when on, a 15px knob. role="switch" on a button.
import type * as React from "react";
import { cn } from "@/lib/utils";

export function SettingSwitch({
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
        "relative inline-block h-[21px] w-[38px] shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-border bg-sunk",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[2px] left-[2px] size-[15px] rounded-full bg-card shadow-sm transition-transform",
          checked ? "translate-x-[17px]" : "translate-x-0",
        )}
      />
    </button>
  );
}
