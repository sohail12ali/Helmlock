import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 [&>svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-sunk text-ink2",
      accent: "border-transparent bg-accent text-primary",
      ok: "border-transparent bg-ok/12 text-ok",
      warn: "border-transparent bg-warn/12 text-warn",
      danger: "border-transparent bg-destructive/12 text-destructive",
      outline: "border-border text-ink2",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
