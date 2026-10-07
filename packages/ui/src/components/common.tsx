// Small shared pieces: the one status vocabulary (F68), copyable `hl` commands, empty and error states.
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "default" | "accent" | "ok" | "warn" | "danger" | "outline";

/** One status vocabulary for stages, tasks, records and runs. */
const TONES: Record<string, Tone> = {
  backlog: "default",
  spec: "accent",
  plan: "accent",
  build: "accent",
  verify: "warn",
  done: "ok",
  todo: "default",
  doing: "accent",
  blocked: "danger",
  open: "warn",
  answered: "ok",
  accepted: "ok",
  rejected: "default",
  fixed: "ok",
  closed: "default",
  withdrawn: "default",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  "no-op": "warn",
  urgent: "danger",
  high: "warn",
  normal: "default",
  low: "default",
};

export function toneOf(status: string): Tone {
  return TONES[status.toLowerCase()] ?? "default";
}

export function StatusChip({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={toneOf(status)} className={className} data-status={status}>
      {label ?? status}
    </Badge>
  );
}

export function Mono({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-mono text-[0.92em]", className)} {...props} />;
}

export function TicketLink({ id, className }: { id: string; className?: string }) {
  return (
    <Link to={`/t/${encodeURIComponent(id)}`} className={cn("font-mono text-primary hover:underline", className)}>
      {id}
    </Link>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Read-only console: anything that would write shows the equivalent `hl` command to copy (no toast, F68). */
export function CopyCommand({ command, label, className }: { command: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-md border bg-sunk py-1 pr-1 pl-2.5", className)}>
      {label && <span className="shrink-0 text-xs text-muted-foreground">{label}</span>}
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={command}>
        {command}
      </code>
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent"
        aria-label={copied ? "Copied" : `Copy: ${command}`}
        onClick={async () => {
          if (await copyText(command)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}

/** Empty states say what to do (F68). */
export function EmptyState({ title, hint, command, className }: { title: string; hint?: ReactNode; command?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm", className)}>
      <p className="font-medium">{title}</p>
      {hint && <p className="text-muted-foreground">{hint}</p>}
      {command && <CopyCommand className="w-full max-w-lg" command={command} />}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">{e ? e.message : "Something went wrong loading this view."}</p>
      {e?.fix && <p className="mt-1 text-muted-foreground">{e.fix}</p>}
      {e && <p className="mt-1 font-mono text-xs text-muted-foreground">{e.rule}</p>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="p-4 text-sm text-muted-foreground" aria-busy="true">
      {label}…
    </div>
  );
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <h1 className="mr-auto text-lg font-semibold">{title}</h1>
      {children}
    </div>
  );
}
