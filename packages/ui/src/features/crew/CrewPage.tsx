// Crew (mockup 16): who is doing what. One card per role with engine and model, what it is doing now and its last
// outcome; a failed engine test shows before anything starts. Drag a ticket onto a role (or use "Hand over…") to hand
// it over. Needs you collects approvals, questions and outcomes waiting across all runs.
import type { CrewView, EngineView, NeedsYouItem, RunState, TicketCard } from "@helmlock/core/contracts";
import { ArrowRight, GripVertical, ShieldAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "@/api/client";
import { useBoard, useStageLabel } from "@/api/hooks";
import { useApprovals, useNow } from "@/api/m4";
import { useCrew, useHandoff, useM8Live, useRunList } from "@/api/m8";
import { useVerb } from "@/api/verbs";
import { useDraggableCard, useDropTicket } from "@/components/actions/dnd";
import { ActionError, failureOf } from "@/components/actions/result";
import { EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { Field, Select, Switch } from "@/components/forms/controls";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveProject } from "@/features/projects/active";
import { ModelField } from "@/features/thread/NextStep";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EngineChip, engineLabel, fmtElapsed, ModelChip, OutcomeBadge, RunStatusChip, runPath, threadPath } from "./bits";

type Role = CrewView["roles"][number];

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Could not reach the server.");

// ---------- role card ----------

function RoleStatus({ role }: { role: Role }) {
  const now = useNow(30_000);
  const running = role.current.filter((r) => r.status === "running");
  const queued = role.current.filter((r) => r.status === "queued");
  if (running.length === 0 && queued.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        Idle
        {role.last && (
          <>
            , last: {role.last.ticket ? <Mono>{role.last.ticket}</Mono> : <Mono>{role.last.id}</Mono>}{" "}
            {role.last.outcome ? <OutcomeBadge outcome={role.last.outcome} /> : <RunStatusChip run={role.last} />}
          </>
        )}
      </p>
    );
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {running.map((r) => (
        <p key={r.id} className="flex flex-wrap items-center gap-1">
          <Badge variant="accent">running</Badge>
          <Link to={r.ticket ? threadPath(r.ticket) : runPath(r.id)} className="font-mono text-primary hover:underline">
            {r.ticket ?? r.id}
          </Link>
          <span className="text-muted-foreground">{fmtElapsed(r.started, now)}</span>
        </p>
      ))}
      {queued.length > 0 && (
        <p className="text-muted-foreground">
          Queue:{" "}
          {queued.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Mono>{r.ticket ?? r.id}</Mono>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function RoleCard({
  role,
  engines,
  selected,
  onOpen,
  onDropTicket,
}: {
  role: Role;
  engines: EngineView[];
  selected: boolean;
  onOpen: () => void;
  onDropTicket: (id: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const over = useDropTicket(ref, onDropTicket);
  return (
    <li
      ref={ref}
      aria-label={`${role.label} role`}
      data-role={role.id}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-shadow",
        selected && "border-primary ring-1 ring-primary",
        over && "ring-2 ring-primary/60",
        !role.engine_ok && "border-destructive/50",
      )}
    >
      <button type="button" onClick={onOpen} className="self-start text-left text-sm font-semibold hover:underline" aria-label={`Open ${role.label}`}>
        {role.label}
      </button>
      <div className="flex flex-wrap items-center gap-1">
        <EngineChip engine={engineLabel(engines, role.engine)} problem={!role.engine_ok && (role.engine_problem ?? "engine test failed")} />
        <ModelChip model={role.model} />
        {role.worktree && <Badge variant="outline">worktree</Badge>}
      </div>
      <RoleStatus role={role} />
      {!role.engine_ok && (
        <p className="text-xs text-destructive" role="note">
          {role.engine_problem ?? "The engine test failed."}
        </p>
      )}
    </li>
  );
}

// ---------- role panel ----------

function RolePanel({ role, engines }: { role: Role; engines: EngineView[] }) {
  const uid = useId();
  const [engine, setEngine] = useState(role.engine);
  const [model, setModel] = useState(role.model ?? "");
  const [worktree, setWorktree] = useState(role.worktree);
  const [saved, setSaved] = useState(false);
  const save = useVerb("crew set", ["crew"]);
  const runs = useRunList({ role: role.id, limit: 10 });
  const view = engines.find((e) => e.id === engine);
  const failure = failureOf(save.data);

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="role-panel">
      <div>
        <h2 className="text-base font-semibold">{role.label}</h2>
        {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
      </div>
      <form
        aria-label={`${role.label} settings`}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          const input: Record<string, unknown> = { role: role.id, engine, worktree };
          if (view?.capabilities.models && model) input.model = model;
          save.mutate({ input }, { onSuccess: (r) => setSaved(r.ok) });
        }}
      >
        <Field label="Engine" htmlFor={`${uid}-engine`}>
          <Select
            id={`${uid}-engine`}
            value={engine}
            onChange={(e) => {
              setEngine(e.target.value);
              setModel("");
            }}
          >
            {engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
                {e.test.ok ? "" : " (not ready)"}
              </option>
            ))}
            {!engines.some((e) => e.id === engine) && <option value={engine}>{engine}</option>}
          </Select>
        </Field>
        {view && view.test.checks.length > 0 && (
          <ul aria-label="Engine test" className="flex flex-col gap-0.5 text-xs">
            {view.test.checks.map((c) => (
              <li key={c.message} className={c.level === "error" ? "text-destructive" : c.level === "warn" ? "text-warn" : "text-muted-foreground"}>
                {c.message}
              </li>
            ))}
          </ul>
        )}
        <ModelField engine={view} value={model} onChange={setModel} />
        <div className="flex items-center gap-2">
          <Switch id={`${uid}-wt`} checked={worktree} onCheckedChange={setWorktree} aria-label="Work in a git worktree" />
          <label htmlFor={`${uid}-wt`} className="text-xs text-ink2">
            Work in a git worktree per ticket
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {saved && (
            <span role="status" className="text-xs text-ok">
              Saved
            </span>
          )}
        </div>
        <ActionError result={failure} />
        {save.isError && (
          <p role="alert" className="text-xs text-destructive">
            {errText(save.error)}
          </p>
        )}
      </form>
      <section>
        <h3 className="mb-1 font-semibold">Recent runs</h3>
        {runs.isPending ? (
          <Loading />
        ) : runs.isError ? (
          <p className="text-xs text-muted-foreground">{errText(runs.error)}</p>
        ) : runs.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <ul aria-label={`Runs of ${role.label}`} className="flex flex-col gap-1">
            {runs.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                <Link to={runPath(r.id)} className="font-mono text-primary hover:underline">
                  {r.id}
                </Link>
                {r.ticket && <Mono>{r.ticket}</Mono>}
                <RunStatusChip run={r} />
                {r.outcome && <OutcomeBadge outcome={r.outcome} />}
                <span className="ml-auto text-muted-foreground">{fmtDateTime(r.started)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- right column ----------

function needsTarget(item: NeedsYouItem): string | undefined {
  if (item.kind === "run-failed" && item.id) return runPath(item.id);
  if (item.ticket) return item.kind === "question" ? `/t/${encodeURIComponent(item.ticket)}?tab=questions` : threadPath(item.ticket);
  if (item.kind === "setup") return "/setup";
  return undefined;
}

function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  const approvals = useApprovals("pending");
  const pending = (approvals.data ?? []).filter((c) => c.status === "pending");
  if (items.length === 0 && pending.length === 0) return <p className="text-xs text-muted-foreground">Nothing needs you right now.</p>;
  return (
    <ul aria-label="Needs you" className="flex flex-col gap-1 text-sm">
      {pending.map((c) => (
        <li key={c.id}>
          <Link to={c.run_id ? runPath(c.run_id) : "/inbox"} className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-accent">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span className="min-w-0">
              Allow {c.input_preview ?? c.tool ?? c.action}
              {c.run_id && <span className="text-xs text-muted-foreground"> ({c.run_id})</span>}
            </span>
          </Link>
        </li>
      ))}
      {items.map((it, i) => {
        const to = needsTarget(it);
        const body = (
          <span className="min-w-0">
            {it.title}
            {it.ticket && <span className="font-mono text-xs text-muted-foreground"> ({it.ticket})</span>}
          </span>
        );
        return (
          <li key={`${it.kind}-${it.id ?? it.ticket ?? i}`}>
            {to ? (
              <Link to={to} className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-accent">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {body}
              </Link>
            ) : (
              <span className="flex gap-1.5 px-1 py-0.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HandOverRow({
  t,
  roles,
  defaultRole,
  stageLabel,
  onHandOver,
}: {
  t: TicketCard;
  roles: Role[];
  defaultRole?: string;
  stageLabel: string;
  onHandOver: (ticket: string, role: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useDraggableCard(ref, t.id, t.stage);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(defaultRole ?? roles[0]?.id ?? "");
  const uid = useId();
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div
          ref={ref}
          data-ticket={t.id}
          className={cn("flex min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-xs", dragging && "opacity-50")}
        >
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Mono className="text-primary">{t.id}</Mono>
          <span className="min-w-0 truncate" title={t.title}>
            {t.title}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">{stageLabel}</span>
        </div>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Hand over ${t.id}`}>
          Hand over…
        </Button>
      </div>
      {open && (
        <form
          aria-label={`Hand over ${t.id}`}
          className="flex items-center gap-1.5 pl-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!role) return;
            onHandOver(t.id, role);
            setOpen(false);
          }}
        >
          <label htmlFor={uid} className="sr-only">
            Role for {t.id}
          </label>
          <Select id={uid} value={role} onChange={(e) => setRole(e.target.value)} className="h-7 text-xs">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm">
            Hand over
          </Button>
        </form>
      )}
    </li>
  );
}

// ---------- page ----------

export function CrewPage() {
  useM8Live();
  const crew = useCrew();
  const board = useBoard();
  const stageLabel = useStageLabel();
  const { project } = useActiveProject();
  const handoff = useHandoff();
  const [params, setParams] = useSearchParams();
  const [started, setStarted] = useState<{ run: RunState; role: string; ticket: string }>();
  const selectedId = params.get("role") ?? undefined;

  const setRole = (id: string | undefined) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set("role", id);
        else n.delete("role");
        return n;
      },
      { replace: true },
    );

  if (crew.isPending) return <Loading />;
  if (crew.isError)
    return (
      <div className="p-4">
        <ErrorState error={crew.error} />
      </div>
    );
  const c = crew.data;
  const selected = c.roles.find((r) => r.id === selectedId);
  const busy = new Set(c.roles.flatMap((r) => r.current.flatMap((x) => (x.ticket ? [x.ticket] : []))));
  const terminal = new Set((board.data?.stages ?? []).filter((s) => s.terminal).map((s) => s.id));
  const stageAgent = new Map((board.data?.stages ?? []).map((s) => [s.id, s.agent]));
  // Open tickets without a live run, in the active project (milestone 7).
  const open = (board.data?.tickets ?? []).filter((t) => !terminal.has(t.stage) && !busy.has(t.id) && (!project || t.project === project));

  const handOver = (ticket: string, role: string) => {
    setStarted(undefined);
    handoff.mutate({ ticket, body: { role } }, { onSuccess: (run) => setStarted({ run, role, ticket }) });
  };
  const label = (id: string) => c.roles.find((r) => r.id === id)?.label ?? id;

  return (
    <PageLayout
      id="crew"
      rightTitle="Role"
      right={selected ? <RolePanel key={selected.id} role={selected} engines={c.engines} /> : undefined}
      onCloseRight={() => setRole(undefined)}
    >
      <PageHeader title="Crew">
        <Badge variant={c.live >= c.max_live ? "warn" : "outline"} aria-label="Live runs">
          {c.live} of {c.max_live} live runs
        </Badge>
      </PageHeader>
      {started && (
        <p role="status" className="mb-3 rounded-md border border-ok/40 bg-ok/5 px-2 py-1 text-sm text-ok">
          {label(started.role)} took <Mono>{started.ticket}</Mono>
          {started.run ? (
            <>
              {" "}
              ({started.run.status === "queued" ? "queued" : "started"}:{" "}
              <Link to={runPath(started.run.id)} className="font-mono underline">
                {started.run.id}
              </Link>
              )
            </>
          ) : null}
        </p>
      )}
      {handoff.isError && (
        <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-sm text-destructive">
          {errText(handoff.error)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-[1fr_18rem]">
        {c.roles.length === 0 ? (
          <EmptyState
            title="No crew roles."
            hint="Roles come from the agent pack; set an engine per role with hl crew set."
            command="hl crew set builder --engine claude-code"
          />
        ) : (
          <ul aria-label="Roles" className="grid content-start grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
            {c.roles.map((r) => (
              <RoleCard
                key={r.id}
                role={r}
                engines={c.engines}
                selected={r.id === selectedId}
                onOpen={() => setRole(r.id)}
                onDropTicket={(ticket) => handOver(ticket, r.id)}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle>Needs you</CardTitle>
            </CardHeader>
            <CardContent>
              <NeedsYou items={c.needs_you} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tickets to hand over</CardTitle>
            </CardHeader>
            <CardContent>
              {board.isPending ? (
                <Loading />
              ) : open.length === 0 ? (
                <p className="text-xs text-muted-foreground">Every open ticket has a run.</p>
              ) : (
                <ul aria-label="Tickets to hand over" className="flex flex-col gap-1.5">
                  {open.map((t) => {
                    const agent = stageAgent.get(t.stage);
                    return (
                      <HandOverRow
                        key={t.id}
                        t={t}
                        roles={c.roles}
                        defaultRole={agent && c.roles.some((r) => r.id === agent) ? agent : undefined}
                        stageLabel={stageLabel(t.stage)}
                        onHandOver={handOver}
                      />
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Drag a ticket onto a role, or use Hand over.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
