// Milestone 8 (Blueprint 33): an assistant plan card. The steps are a ledger (◌ proposed, ◔ approved and waiting,
// ✔ started, ⊘ skipped, ✗ failed); the person approves or skips each step, approves all, or sends a revision back to
// the assistant. Started steps link to their ticket page, where the run shows on the thread.
import type { ChatMessageData, PlanCard as Plan, PlanDecision, PlanDecisionResult } from "@helmlock/core/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { post } from "@/api/m4";
import { Mono } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = Plan["steps"][number];
type Choice = "approve" | "skip";

const MARK: Record<Step["status"], { glyph: string; label: string; tone: string }> = {
  proposed: { glyph: "◌", label: "proposed", tone: "text-muted-foreground" },
  approved: { glyph: "◔", label: "approved, waits for the step before it", tone: "text-primary" },
  started: { glyph: "✔", label: "started", tone: "text-emerald-600 dark:text-emerald-400" },
  skipped: { glyph: "⊘", label: "skipped", tone: "text-muted-foreground" },
  failed: { glyph: "✗", label: "failed", tone: "text-destructive" },
};

export function decidePlan(chatId: string, planId: string, body: PlanDecision): Promise<PlanDecisionResult> {
  return post<PlanDecisionResult>(`/chats/${encodeURIComponent(chatId)}/plans/${encodeURIComponent(planId)}`, body);
}

const ticketHref = (t: string) => `/t/${encodeURIComponent(t)}`;

function Toggle({ value, onChange, index }: { value: Choice | undefined; onChange: (c: Choice | undefined) => void; index: number }) {
  const opt = (c: Choice, label: string) => (
    <button
      type="button"
      aria-pressed={value === c}
      aria-label={`${label} step ${index + 1}`}
      onClick={() => onChange(value === c ? undefined : c)}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        value === c ? (c === "approve" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground") : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
  return (
    <span className="inline-flex shrink-0 gap-0.5 rounded-md border p-0.5">
      {opt("approve", "Approve")}
      {opt("skip", "Skip")}
    </span>
  );
}

/** One plan card in the chat flow. `onChange` gets the server's updated card. */
export function PlanCard({
  chatId,
  message,
  onChange,
}: {
  chatId: string;
  message: ChatMessageData;
  onChange?: (m: ChatMessageData, revised: boolean) => void;
}) {
  const [plan, setPlan] = useState<Plan | undefined>(message.plan);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [revising, setRevising] = useState(false);
  const [revise, setRevise] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A refetched chat (e.g. the next step started when a run reported done) replaces the local copy.
  useEffect(() => setPlan(message.plan), [message.plan]);
  if (!plan) return null;

  const submit = async (body: PlanDecision) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await decidePlan(chatId, plan.id, body);
      setPlan(next);
      setChoices({});
      setRevising(false);
      setRevise("");
      onChange?.({ ...message, plan: next }, !!body.revise);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.fix ? ` (${e.fix})` : ""}` : "Could not send the decision.");
    } finally {
      setBusy(false);
    }
  };

  const proposed = plan.steps.map((s, i) => [s, i] as const).filter(([s]) => s.status === "proposed");
  const approveAll = () => void submit({ decisions: Object.fromEntries(proposed.map(([, i]) => [String(i), "approve" as const])) });
  const hasChoice = Object.keys(choices).length > 0;
  const canSubmit = !busy && (hasChoice || (revising && revise.trim().length > 0));

  return (
    <section aria-label={`Plan: ${plan.title}`} data-plan={plan.id} className="rounded-lg border bg-card p-3 text-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan</span>
        <span className="min-w-0 flex-1 font-medium">{plan.title}</span>
        <span className="text-xs text-muted-foreground" data-testid="plan-status">
          {plan.status}
        </span>
      </header>
      <ol className="flex flex-col divide-y">
        {plan.steps.map((s, i) => {
          const mark = MARK[s.status];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and never reordered
            <li key={i} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0" data-step={i} data-status={s.status}>
              <div className="flex flex-wrap items-start gap-2">
                <span className={cn("w-4 shrink-0 text-center font-mono", mark.tone)} title={mark.label} role="img" aria-label={mark.label}>
                  {mark.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}.</span>
                  <Link to={ticketHref(s.ticket)} className="font-mono text-primary hover:underline">
                    {s.ticket}
                  </Link>{" "}
                  <span className="font-medium">{s.role}</span>
                  {s.engine && <span className="text-muted-foreground"> on {s.engine}</span>}
                  <span className="block break-words">{s.task}</span>
                  <span className="block text-xs text-muted-foreground">DONE when: {s.done_check}</span>
                  {s.status === "started" && s.run && (
                    <Link to={ticketHref(s.ticket)} className="text-xs text-primary hover:underline">
                      Run <Mono>{s.run}</Mono> on the ticket thread
                    </Link>
                  )}
                  {s.status === "failed" && s.error && (
                    <span role="alert" className="block text-xs text-destructive">
                      {s.error}
                    </span>
                  )}
                </span>
                {s.status === "proposed" && (
                  <Toggle
                    index={i}
                    value={choices[String(i)]}
                    onChange={(c) =>
                      setChoices((cur) => {
                        const next = { ...cur };
                        if (c) next[String(i)] = c;
                        else delete next[String(i)];
                        return next;
                      })
                    }
                  />
                )}
                {(s.status === "approved" || s.status === "failed") && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void submit({ decisions: { [String(i)]: "approve" } })}>
                    {s.status === "failed" ? "Retry" : "Start"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {revising && (
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
          What should change?
          <textarea
            value={revise}
            onChange={(e) => setRevise(e.target.value)}
            rows={2}
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            placeholder="e.g. only the spec, and use Cursor"
          />
        </label>
      )}
      {(proposed.length > 0 || revising) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {proposed.length > 0 && (
            <Button size="sm" disabled={busy} onClick={approveAll}>
              Approve all
            </Button>
          )}
          {!revising && proposed.length > 0 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRevising(true)}>
              Revise…
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canSubmit}
            onClick={() => void submit({ decisions: choices, ...(revising && revise.trim() ? { revise: revise.trim() } : {}) })}
          >
            Submit
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
