import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** A drawer: side panels become sheets below 900 px (F82). */
const Sheet = SheetPrimitive.Root;

function SheetContent({
  className,
  children,
  side = "right",
  title,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right"; title: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
      <SheetPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          "fixed inset-y-0 z-50 flex w-[min(24rem,88vw)] flex-col bg-card shadow-xl",
          side === "right" ? "right-0 border-l animate-slide-in-right" : "left-0 border-r animate-slide-in-left",
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 rounded-sm opacity-70 hover:opacity-100" aria-label="Close">
          <XIcon className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetContent };
