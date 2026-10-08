// A run as a timeline (Blueprint 33, mockup 15): grouped steps, diffs that open, approvals inline, the outcome card
// at the end, gestures by capability (Steer only when the engine can), and a side rail (todos, files, cost).
import type { RunOutcome, RunState } from "@helmlock/core/contracts";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileDiff,
  FileSearch,
  FileText,
  GitMerge,
  ListTodo,
  MessageSquare,
  OctagonX,
  ShieldAlert,
  Shrink,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { useApprovals, useCancelRun, useNow, useRunStream } from "@/api/m4";
import { useHandoff, useMergeRun, useRunDiff, useRunSay } from "@/api/m8";
import { Mono, StatusChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { fmtCost, fmtTokens } from "@/lib/format";
import { previewInput } from "@/lib/run-flags";
import { cn } from "@/lib/utils";
import { EngineChip, engineLabel, fmtElapsed, isLive, ModelChip, OutcomeBadge, RunStatusChip, roleLabel, runPath, useEngines } from "./bits";
import { type Timeline, type TimelineRow, toolsLabel, toolsState, toTimeline } from "./timeline";

/** Follow a run's events and fold them into a timeline. */
export function useRunTimeline(id: string | undefined) {
  const { lines, state } = useRunStream(id);
  const timeline = useMemo(() => toTimeline(lines), [lines]);
  return { timeline, state, lines };
}

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

// ---------- rows ----------

function Expandable({ summary, children, icon, tone }: { summary: ReactNode; children?: ReactNode; icon: ReactNode; tone?: string }) {
  const [open, setOpen] = useState(false);
  if (!children)
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5 text-xs", tone)}>
        {icon}
        {summary}
      </div>
    );
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex min-w-0 items-center gap-1.5 rounded text-left text-xs hover:bg-accent", tone)}
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        {icon}
        {summary}
      </button>
      {open && <div className="mt-1 ml-4">{children}</div>}
    </div>
  );
}

export function PatchView({ patch }: { patch: string }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-sunk p-2 font-mono text-[11px] leading-snug" data-testid="patch">
      {patch.split("\n").map((l, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positional
          key={i}
          className={cn(
            "block whitespace-pre",
            l.startsWith("+") && !l.startsWith("+++") && "text-ok",
            l.startsWith("-") && !l.startsWith("---") && "text-destructive",
          )}
        >
          {l || " "}
        </span>
      ))}
    </pre>
  );
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p;

function StateIcon({ state }: { state: "running" | "failed" | "ok" }) {
  if (state === "running") return <CircleDashed className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-label="running" />;
  if (state === "failed") return <XCircle className="size-3.5 shrink-0 text-destructive" aria-label="failed" />;
  return <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-label="ok" />;
}

const TOOL_ICON = { read: FileText, search: FileSearch, shell: Terminal, edit: FileDiff, other: Wrench } as const;

function ApprovalRow({ row }: { row: Extract<TimelineRow, { kind: "approval" }> }) {
  const q = useApprovals("pending");
  const card = q.data?.find((c) => c.id === row.id);
  if (card && card.status === "pending" && row.status === "pending") return <ApprovalCard card={card} showSource={false} />;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-approval-row={row.id}>
      <ShieldAlert className="size-3.5 shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 text-ink2">{row.summary}</span>
      <StatusChip status={row.status === "allowed" ? "succeeded" : row.status === "denied" ? "failed" : "open"} label={row.status} />
    </div>
  );
}

function Row({ row }: { row: TimelineRow }) {
  switch (row.kind) {
    case "tools": {
      const Icon = TOOL_ICON[row.tool];
      const state = toolsState(row);
      return (
        <Expandable
          icon={<StateIcon state={state} />}
          tone={state === "failed" ? "text-destructive" : "text-ink2"}
          summary={
            <span className="flex min-w-0 items-center gap-1.5" data-row="tools" data-tool={row.tool}>
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{toolsLabel(row)}</span>
              {state === "failed" && <span className="sr-only">failed</span>}
            </span>
          }
        >
          {row.calls.length > 1 || row.tool === "shell" || row.tool === "other" ? (
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
              {row.calls.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: calls are positional
                <li key={i} className={cn("truncate", c.isError && "text-destructive")}>
                  {c.name} {previewInput(c.input)}
                </li>
              ))}
            </ul>
          ) : undefined}
        </Expandable>
      );
    }
    case "diff":
      return (
        <Expandable
          icon={<FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          tone="text-ink2"
          summary={
            <span data-row="diff">
              Edited <Mono>{basename(row.file)}</Mono> <span className="text-ok">+{row.added}</span> <span className="text-destructive">-{row.removed}</span>
            </span>
          }
        >
          {row.patch ? <PatchView patch={row.patch} /> : undefined}
        </Expandable>
      );
    case "text":
      return <p className="text-sm whitespace-pre-wrap break-words">{row.text}</p>;
    case "thinking":
      return (
        <details className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1.5">
            <Brain className="size-3.5" /> Thinking
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{row.text}</p>
        </details>
      );
    case "plan":
      return (
        <details className="rounded-md border px-2 py-1 text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-ink2">
            <ListTodo className="size-3.5" /> Plan
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{row.text}</p>
        </details>
      );
    case "approval":
      return <ApprovalRow row={row} />;
    case "message":
      return (
        <div className="flex items-start gap-1.5 rounded-md bg-accent/60 px-2 py-1 text-sm" data-row="message">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="text-xs text-muted-foreground">
              {row.by}, {row.delivered === "live" ? "steered" : "queued"}:{" "}
            </span>
            {row.text}
          </span>
        </div>
      );
    case "compaction":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-row="compaction">
          <Shrink className="size-3.5" aria-hidden /> Context compacted: {fmtTokens(row.before)} to {fmtTokens(row.after)} tokens
        </p>
      );
    case "error":
      return (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive" data-row="error">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {row.message}
            {row.retryable ? " (retrying)" : ""}
          </span>
        </p>
      );
    case "stderr":
      return (
        <details className="text-xs text-warn">
          <summary className="cursor-pointer">stderr</summary>
          <pre className="mt-1 overflow-x-auto font-mono whitespace-pre-wrap">{row.text}</pre>
        </details>
      );
    case "result":
      return (
        <p className={cn("flex items-start gap-1.5 text-xs", row.ok ? "text-ink2" : "text-destructive")} data-testid="run-result">
          {row.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
          <span className="whitespace-pre-wrap">
            {row.text}
            {row.failureClass ? ` (${row.failureClass})` : ""}
          </span>
        </p>
      );
  }
}

// ---------- outcome, gestures, worktree ----------

export function OutcomeCard({ run, outcome, onReviewDiff }: { run: RunState; outcome: RunOutcome | "none"; onReviewDiff?: () => void }) {
  const handoff = useHandoff();
  const [started, setStarted] = useState<RunState>();
  const next = outcome !== "none" ? outcome.next : undefined;
  return (
    <section
      aria-label="Outcome"
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-sm",
        outcome === "none" ? "border-dashed" : outcome.outcome === "done" ? "border-ok/40 bg-ok/5" : "border-warn/40 bg-warn/5",
      )}
    >
      <p className="flex flex-wrap items-center gap-1.5">
        <OutcomeBadge outcome={outcome} />
        <span className="min-w-0">{outcome === "none" ? "The run ended without reporting an outcome." : outcome.summary}</span>
      </p>
      {(onReviewDiff || (next && run.ticket)) && (
        <div className="flex flex-wrap gap-1.5">
          {onReviewDiff && (
            <Button size="sm" variant="outline" onClick={onReviewDiff}>
              <FileDiff /> Review diff
            </Button>
          )}
          {next && run.ticket && outcome !== "none" && !started && (
            <Button
              size="sm"
              disabled={handoff.isPending}
              onClick={() =>
                handoff.mutate({ ticket: run.ticket!, body: outcome.next_role ? { role: outcome.next_role } : {} }, { onSuccess: (r) => setStarted(r) })
              }
            >
              <ArrowRight /> Next: {outcome.next_role ? `${roleLabel(outcome.next_role)} ` : ""}
              {next}
            </Button>
          )}
        </div>
      )}
      {started && (
        <p role="status" className="text-xs text-ok">
          Handed off: <Link to={runPath(started.id)}>{started.id}</Link> {started.status}
        </p>
      )}
      {handoff.isError && (
        <p role="alert" className="text-xs text-destructive">
          {errMsg(handoff.error, "Could not hand off.")}
        </p>
      )}
    </section>
  );
}

function StopButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelRun(id);
  if (!confirming)
    return (
      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
        <OctagonX /> Stop
      </Button>
    );
  return (
    <div
      role="alertdialog"
      aria-label="Confirm stop"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm"
    >
      <span>Stop this run and its child processes?</span>
      <Button
        size="sm"
        className="bg-destructive text-white"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      >
        {cancel.isPending ? "Stopping" : "Stop run"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep running
      </Button>
      {cancel.isError && (
        <span role="alert" className="w-full text-xs text-destructive">
          {errMsg(cancel.error, "Could not stop.")}
        </span>
      )}
    </div>
  );
}

/** Steer only when the engine can take input mid-run; otherwise the note waits for the next turn. Stop always. */
export function RunGestures({ run }: { run: RunState }) {
  const steer = !!run.capabilities?.steer && run.status === "running";
  const say = useRunSay(run.id);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string>();
  const label = steer ? "Steer" : "Queue a note";
  const send = () => {
    const t = text.trim();
    if (!t || say.isPending) return;
    say.mutate(t, {
      onSuccess: (r) => {
        setText("");
        setSent(r?.delivered === "live" ? "Delivered to the running agent." : "Queued for the next turn.");
      },
    });
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="run-gestures">
      <form
        aria-label={label}
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          aria-label={steer ? "Steer the run" : "Note for the next turn"}
          placeholder={steer ? "Tell the agent something now" : "A note for the next turn"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-7 min-w-40 flex-1 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!text.trim() || say.isPending}>
          {steer ? "Steer" : "Queue"}
        </Button>
        <StopButton id={run.id} />
      </form>
      {!!run.queued_messages && <p className="text-xs text-muted-foreground">{run.queued_messages} queued for the next turn</p>}
      {sent && (
        <p role="status" className="text-xs text-ok">
          {sent}
        </p>
      )}
      {say.isError && (
        <p role="alert" className="text-xs text-destructive">
          {errMsg(say.error, "Could not send.")}
        </p>
      )}
    </div>
  );
}

/** Worktree runs (F156): review the diff against the base, then merge with an in-page confirmation. */
export function WorktreePanel({ run, open, onToggle }: { run: RunState; open: boolean; onToggle: () => void }) {
  const wt = run.worktree;
  const diff = useRunDiff(run.id, open && !!wt);
  const merge = useMergeRun(run.id, run.ticket);
  const [confirming, setConfirming] = useState(false);
  if (!wt) return null;
  const merged = wt.merged || merge.data?.merged;
  return (
    <section aria-label="Worktree" className="flex flex-col gap-2 rounded-md border bg-sunk/40 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <GitMerge className="size-3.5 text-muted-foreground" aria-hidden />
        <Mono>{wt.branch}</Mono>
        {merged && <Badge variant="ok">merged</Badge>}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" aria-expanded={open} onClick={onToggle}>
            <FileDiff /> {open ? "Hide diff" : "Review diff"}
          </Button>
          {!merged && !isLive(run) && !confirming && (
            <Button size="sm" onClick={() => setConfirming(true)}>
              <GitMerge /> Merge
            </Button>
          )}
        </span>
      </div>
      {confirming && !merged && (
        <div role="alertdialog" aria-label="Confirm merge" className="flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/5 px-2 py-1.5">
          <span>
            Merge <Mono>{wt.branch}</Mono> into the project's current branch? It refuses on a conflict.
          </span>
          <Button size="sm" disabled={merge.isPending} onClick={() => merge.mutate(undefined, { onSettled: () => setConfirming(false) })}>
            {merge.isPending ? "Merging" : "Merge now"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      {merge.data && (
        <p role="status" className={merge.data.merged ? "text-ok" : "text-destructive"}>
          {merge.data.message}
        </p>
      )}
      {merge.isError && (
        <p role="alert" className="text-destructive">
          {errMsg(merge.error, "Could not merge.")}
        </p>
      )}
      {open &&
        (diff.isPending ? (
          <p className="text-muted-foreground">Loading the diff…</p>
        ) : diff.isError ? (
          <p role="alert" className="text-destructive">
            {errMsg(diff.error, "Could not load the diff.")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5" data-testid="run-diff">
            <ul aria-label="Changed files" className="flex flex-col gap-0.5 font-mono">
              {diff.data.files.map((f) => (
                <li key={f.file}>
                  {f.file} <span className="text-ok">+{f.added}</span> <span className="text-destructive">-{f.removed}</span>
                </li>
              ))}
            </ul>
            {diff.data.patch && <PatchView patch={diff.data.patch} />}
          </div>
        ))}
    </section>
  );
}

// ---------- header and rail ----------

export function runUsage(run: RunState, t?: Timeline) {
  return run.usage ?? t?.usage;
}

export function RunHeader({ run, timeline, link = true }: { run: RunState; timeline?: Timeline; link?: boolean }) {
  const engines = useEngines();
  const now = useNow(isLive(run) ? 15_000 : 3_600_000);
  const usage = runUsage(run, timeline);
  const engine = engines.find((e) => e.id === run.runtime);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="font-semibold">{roleLabel(run.role ?? run.agent)}</span>
      <EngineChip
        engine={engineLabel(engines, run.runtime)}
        problem={engine && !engine.test.ok ? engine.test.checks[0]?.message || "engine test failed" : false}
      />
      <ModelChip model={run.model ?? timeline?.model} />
      <RunStatusChip run={run} />
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {link ? (
          <Link to={runPath(run.id)} className="font-mono text-primary hover:underline">
            {run.id}
          </Link>
        ) : (
          <Mono>{run.id}</Mono>
        )}
        {run.status !== "queued" && <span>{fmtElapsed(run.started, run.ended ? new Date(run.ended).getTime() : now)}</span>}
        {usage && <span className="font-mono">{fmtTokens(usage.input_tokens + usage.output_tokens)} tokens</span>}
        {usage?.cost_usd != null && <span className="font-mono">{fmtCost(usage.cost_usd)}</span>}
      </span>
    </div>
  );
}
export function RunRail({ run, timeline }: { run: RunState; timeline: Timeline }) {
  const usage = runUsage(run, timeline);
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="run-rail">
      <section>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Todos</h3>
        {timeline.todos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No todo list yet.</p>
        ) : (
          <ul aria-label="Todos" className="flex flex-col gap-0.5">
            {timeline.todos.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: todo items are positional
              <li key={i} className={cn("flex items-start gap-1.5 text-xs", t.status === "done" && "text-muted-foreground line-through")}>
                {t.status === "done" ? (
                  <CheckCircle2 className="mt-px size-3.5 shrink-0 text-ok" aria-label="done" />
                ) : t.status === "in_progress" ? (
                  <CircleDashed className="mt-px size-3.5 shrink-0 text-primary" aria-label="in progress" />
                ) : (
                  <span className="mt-px size-3.5 shrink-0 rounded-full border" role="img" aria-label="pending" />
                )}
                <span className="min-w-0">{t.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Files changed</h3>
        {timeline.files.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul aria-label="Files changed" className="flex flex-col gap-0.5 font-mono text-xs">
            {timeline.files.map((f) => (
              <li key={f.file} title={f.file} className="truncate">
                {basename(f.file)} <span className="text-ok">+{f.added}</span> <span className="text-destructive">-{f.removed}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Cost</h3>
        <p className="font-mono text-lg font-semibold">{usage?.cost_usd != null ? fmtCost(usage.cost_usd) : "-"}</p>
        <p className="text-xs text-muted-foreground">{usage ? `${fmtTokens(usage.input_tokens + usage.output_tokens)} tokens` : "no usage yet"}</p>
      </section>
    </div>
  );
}

// ---------- body and card ----------

/** Rows, then the outcome card, the gestures for a live run, and the worktree panel. */
export function RunBody({ run, timeline, state }: { run: RunState; timeline: Timeline; state: string }) {
  const [diffOpen, setDiffOpen] = useState(false);
  const outcome: RunOutcome | "none" | undefined = timeline.outcome ?? run.outcome;
  const running = isLive(run) && state !== "ended";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {timeline.rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {run.status === "queued"
            ? "Waiting for a free slot."
            : state === "unavailable"
              ? "No live timeline for this run."
              : state === "ended"
                ? "This run produced no output."
                : "Waiting for output…"}
        </p>
      )}
      <ol className="flex flex-col gap-1.5" data-testid="run-timeline" aria-live="polite">
        {timeline.rows.map((r) => (
          <li key={r.key}>
            <Row row={r} />
          </li>
        ))}
      </ol>
      {outcome && <OutcomeCard run={run} outcome={outcome} onReviewDiff={run.worktree && !diffOpen ? () => setDiffOpen(true) : undefined} />}
      <WorktreePanel run={run} open={diffOpen} onToggle={() => setDiffOpen((o) => !o)} />
      {running && <RunGestures run={run} />}
    </div>
  );
}

function StreamedRun({ run }: { run: RunState }) {
  const { timeline, state } = useRunTimeline(run.id);
  return (
    <>
      <RunHeader run={run} timeline={timeline} />
      <div className="@container mt-2">
        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-[1fr_13rem]">
          <RunBody run={run} timeline={timeline} state={state} />
          <details open className="rounded-md border p-2 @2xl:rounded-none @2xl:border-0 @2xl:border-l @2xl:pl-3" aria-label="This run">
            <summary className="cursor-pointer text-xs font-medium">This run</summary>
            <div className="mt-2">
              <RunRail run={run} timeline={timeline} />
            </div>
          </details>
        </div>
      </div>
    </>
  );
}

/** A run in the ticket thread. Live and latest runs open with their timeline; older ones show the outcome only. */
export function RunCard({ run, defaultOpen = false }: { run: RunState; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || isLive(run));
  return (
    <article aria-label={`Run ${run.id}`} className="rounded-lg border bg-card p-3" data-run={run.id}>
      {open ? (
        <StreamedRun run={run} />
      ) : (
        <div className="flex flex-col gap-2">
          <RunHeader run={run} />
          {run.outcome && <OutcomeCard run={run} outcome={run.outcome} />}
        </div>
      )}
      <Button size="sm" variant="ghost" className="mt-1" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide steps" : "Show steps"}
      </Button>
    </article>
  );
}
