// Small form pieces for the ticket actions (hand-laid forms; the generic VerbForm lives in components/forms).

import type { VerbCallResult } from "@helmlock/core/api";
import { Eye } from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionError, DryRunPreview } from "./result";
import type { Action } from "./use-action";

const control =
  "w-full min-w-0 rounded-md border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs text-muted-foreground", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-8 pr-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-16 py-1.5", className)} {...props} />;
}

export const SIZES = ["S", "M", "L"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const LAYERS = ["db", "api", "ui", "test", "env", "spike", "docs"] as const;
export const TASK_STATUSES = ["todo", "doing", "done", "blocked"] as const;

/**
 * A form that writes through one verb. `input()` builds the exact verb input; Preview runs it as a dry run.
 * On success the form resets via `onDone`; a failure stays next to the buttons until the next try.
 */
export function ActionForm({
  action,
  input,
  submitLabel,
  onDone,
  canSubmit = true,
  preview = true,
  children,
  className,
  label,
}: {
  action: Action;
  input: () => Record<string, unknown>;
  submitLabel: string;
  onDone?: (r: Extract<VerbCallResult, { ok: true }>) => void;
  canSubmit?: boolean;
  preview?: boolean;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || action.pending) return;
    const r = await action.run(input());
    if (r.ok) {
      action.reset();
      onDone?.(r);
    }
  };
  return (
    <form aria-label={label} onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit || action.pending}>
          {action.pending ? "Saving…" : submitLabel}
        </Button>
        {preview && (
          <Button type="button" size="sm" variant="ghost" disabled={!canSubmit || action.pending} onClick={() => void action.preview(input())}>
            <Eye />
            Preview
          </Button>
        )}
      </div>
      <ActionError result={action.failure} />
      <DryRunPreview result={action.previewResult} />
    </form>
  );
}
