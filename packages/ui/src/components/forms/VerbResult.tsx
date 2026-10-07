// How a verb call ends, shown inline next to the form that made it (F68: no toasts).
import type { VerbCallResult } from "@helmlock/core/api";
import { cn } from "@/lib/utils";

/** A write the tool chose not to make (for example a duplicate work-log line) is a normal, calm outcome. */
export function skippedReason(r: VerbCallResult): string | undefined {
  if (!r.ok || !r.data || typeof r.data !== "object") return undefined;
  const d = r.data as { written?: unknown; reason?: unknown };
  return d.written === false && typeof d.reason === "string" ? d.reason : undefined;
}

export function VerbResult({
  result,
  preview,
  okText,
  className,
}: {
  result: VerbCallResult | undefined;
  /** The call was a dry run: nothing was written. */
  preview?: boolean;
  okText?: string;
  className?: string;
}) {
  if (!result) return null;
  if (!result.ok) {
    const blocked = result.code === 2;
    return (
      <div role="alert" className={cn("rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm", className)}>
        <p className="font-medium text-destructive">
          {blocked ? "Blocked: " : ""}
          {result.error.message}
        </p>
        {result.error.fix && <p className="mt-0.5 text-ink2">Fix: {result.error.fix}</p>}
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          {result.error.rule}
          {result.error.file ? ` · ${result.error.file}` : ""}
        </p>
      </div>
    );
  }
  const skipped = skippedReason(result);
  if (skipped) {
    return (
      <p role="status" className={cn("rounded-md border bg-sunk px-3 py-2 text-sm text-ink2", className)}>
        <span className="font-medium">Skipped: {skipped}.</span> {result.text ?? "Nothing new to write."}
      </p>
    );
  }
  return (
    <p role="status" className={cn("rounded-md border px-3 py-2 text-sm", preview ? "bg-sunk text-ink2" : "border-ok/40 bg-ok/5", className)}>
      {preview && <span className="font-medium">Preview (nothing written): </span>}
      {result.text ?? okText ?? (preview ? "the input is valid." : "Done.")}
    </p>
  );
}
