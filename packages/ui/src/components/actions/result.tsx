// How a verb result shows next to the control that sent it: rule + message + fix inline, never a toast (F68).
import type { VerbCallResult } from "@helmlock/core/api";
import { AlertTriangle, Ban } from "lucide-react";
import { Mono } from "@/components/common";
import { cn } from "@/lib/utils";

export type VerbFailure = Extract<VerbCallResult, { ok: false }>;
export interface Reason {
  rule: string;
  message: string;
  fix?: string;
}

/** Gate reasons from a code-2 result: data.gate.reasons or data.reasons when the server sends them, else the message lines. */
export function gateReasons(r: VerbFailure): Reason[] {
  const d = r.data as { gate?: { reasons?: Reason[] }; reasons?: Reason[] } | undefined;
  const fromData = d?.gate?.reasons ?? d?.reasons;
  if (Array.isArray(fromData) && fromData.length > 0) return fromData;
  // "ticket move" with several reasons: "<first message>\n- rule: message\n- rule: message"; the fix belongs to the first.
  const bullets = r.error.message
    .split("\n")
    .map((l) => /^- ([^:]+): (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m): Reason => ({ rule: m[1]!, message: m[2]! }));
  if (bullets.length > 1) {
    bullets[0] = { ...bullets[0]!, ...(r.error.fix ? { fix: r.error.fix } : {}) };
    return bullets;
  }
  return [{ rule: r.error.rule, message: r.error.message, ...(r.error.fix ? { fix: r.error.fix } : {}) }];
}

/** Inline failure: a gate block (code 2) lists every reason with its fix; any other failure shows rule, message, fix. */
export function ActionError({ result, className, onDismiss }: { result: VerbFailure | null | undefined; className?: string; onDismiss?: () => void }) {
  if (!result) return null;
  const isBlock = result.code === 2;
  const reasons = isBlock ? gateReasons(result) : [{ rule: result.error.rule, message: result.error.message, fix: result.error.fix }];
  const Icon = isBlock ? Ban : AlertTriangle;
  return (
    <div
      role="alert"
      data-testid="action-error"
      className={cn("rounded-md border p-2 text-xs", isBlock ? "border-warn/50 bg-warn/5" : "border-destructive/40 bg-destructive/5", className)}
    >
      <div className="flex items-start gap-1.5">
        <Icon className={cn("mt-px size-3.5 shrink-0", isBlock ? "text-warn" : "text-destructive")} aria-hidden />
        <ul className="flex min-w-0 flex-1 flex-col gap-1">
          {reasons.map((r) => (
            <li key={r.rule + r.message}>
              <span className="font-medium text-foreground">{isBlock ? "Blocked: " : ""}</span>
              <span className="whitespace-pre-wrap">{r.message}</span> <Mono className="text-muted-foreground">({r.rule})</Mono>
              {r.fix && (
                <span className="block text-muted-foreground">
                  Fix: <Mono className="text-foreground">{r.fix}</Mono>
                </span>
              )}
            </li>
          ))}
        </ul>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1 text-muted-foreground hover:bg-accent" aria-label="Dismiss">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

interface WouldWrite {
  path: string;
  text?: string;
}

/** Dry-run result: the files the verb would write, with their content folded away. */
export function DryRunPreview({ result }: { result: VerbCallResult | null | undefined }) {
  if (!result?.ok) return null;
  const files = ((result.data as { would_write?: WouldWrite[] } | null)?.would_write ?? []) as WouldWrite[];
  return (
    <div className="rounded-md border border-dashed bg-sunk/50 p-2 text-xs" data-testid="dry-run">
      <p className="font-medium">Preview (nothing written)</p>
      {result.text && <p className="whitespace-pre-wrap text-muted-foreground">{result.text}</p>}
      {files.length === 0 ? (
        <p className="text-muted-foreground">No files would change.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.path}>
              <details>
                <summary className="cursor-pointer font-mono">{f.path}</summary>
                {f.text && <pre className="mt-1 max-h-48 overflow-auto rounded bg-card p-2 font-mono text-[11px]">{f.text}</pre>}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const failureOf = (r: VerbCallResult | undefined | null): VerbFailure | null => (r && !r.ok ? r : null);
