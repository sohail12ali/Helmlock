import type { BugRecord, DecisionRecord, GapRecord, QuestionRecord, Task, TicketDetail } from "@helmlock/core/contracts";
import { ChevronRight, Copy, MessageCircleQuestion, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useArtifact, useRuns, useStageLabel, useTicket } from "@/api/hooks";
import { BugForm, DecisionForm, GapForm, QuestionCard, QuestionForm, ResolveRecord, TaskForm, TaskStatusToggle } from "@/components/actions/RecordActions";
import { BlockControl, ClaimControl, FieldsEditor, MoveControls } from "@/components/actions/TicketControls";
import { EmptyState, ErrorState, Loading, Mono, StatusChip } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { RunsTable } from "@/components/RunsTable";
import { FileList, TicketChips } from "@/components/TicketBits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArtifactViewer } from "@/components/viewers/ArtifactViewer";
import { NextStepBar } from "@/features/thread/NextStep";
import { TicketThreadView } from "@/features/thread/TicketThread";
import { fmtBytes, fmtDateTime } from "@/lib/format";

type Rec<T> = T & { kind: string; path: string };
const byKind = <T,>(d: TicketDetail, kind: string) => d.records.filter((r) => r.kind === kind) as unknown as Rec<T>[];

/** A folded "add" form, so the record lists stay first. */
function AddBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border p-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ink2 hover:text-foreground">
        <Plus className="size-4" />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Crumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {items.map((it, i) => (
        <span key={typeof it.label === "string" ? it.label : i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" />}
          {it.to ? (
            <Link to={it.to} className="hover:text-foreground hover:underline">
              {it.label}
            </Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function DecisionsTable({ decisions }: { decisions: Rec<DecisionRecord>[] }) {
  if (decisions.length === 0) return <EmptyState title="No decisions yet." hint="Record one with Add a decision on the Decisions tab." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Decisions">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-3 font-medium">Id</th>
            <th className="py-1.5 pr-3 font-medium">Decision</th>
            <th className="py-1.5 pr-3 font-medium">Chosen</th>
            <th className="py-1.5 pr-3 font-medium">Why</th>
            <th className="py-1.5 pr-3 font-medium">Rejected</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.id} className="border-b align-top last:border-0">
              <td className="py-1.5 pr-3">
                <Mono>{d.id}</Mono>
              </td>
              <td className="py-1.5 pr-3">{d.title}</td>
              <td className="py-1.5 pr-3 font-medium">{d.chosen ?? "-"}</td>
              <td className="py-1.5 pr-3 text-ink2">{d.why ?? ""}</td>
              <td className="py-1.5 pr-3 text-ink2">{d.rejected.join(", ") || "-"}</td>
              <td className="py-1.5 pr-3">
                <StatusChip status={d.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionsList({ questions, onlyOpen = false }: { questions: Rec<QuestionRecord>[]; onlyOpen?: boolean }) {
  const list = onlyOpen ? questions.filter((q) => q.status === "open") : questions;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{onlyOpen ? "No open questions." : "No questions on this ticket."}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {list.map((q) =>
        q.status === "open" ? (
          <li key={q.id}>
            <QuestionCard q={q} />
          </li>
        ) : (
          <li key={q.id} className="flex gap-2 text-sm">
            <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Mono className="text-xs">{q.id}</Mono>
                {q.blocking && <Badge variant="danger">blocking</Badge>}
                <StatusChip status={q.status} />
                <span className="text-xs text-muted-foreground">
                  asked {fmtDateTime(q.asked)} by <Mono>{q.author}</Mono>
                </span>
              </div>
              <p className="mt-0.5">{q.text}</p>
              {q.options.length > 0 && <p className="text-xs text-muted-foreground">Options: {q.options.join(" / ")}</p>}
              {q.answer && <p className="mt-1 rounded-md bg-sunk px-2 py-1 text-ink2">{q.answer}</p>}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

function BugsAndGaps({ bugs, gaps }: { bugs: Rec<BugRecord>[]; gaps: Rec<GapRecord>[] }) {
  const open = [...bugs.filter((b) => b.status === "open"), ...gaps.filter((g) => g.status === "open")];
  if (open.length === 0) return <p className="text-sm text-muted-foreground">No open bugs or gaps.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm" aria-label="Open bugs and gaps">
      {bugs
        .filter((b) => b.status === "open")
        .map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-1.5">
            <Mono className="text-xs">{b.id}</Mono>
            <StatusChip status={b.severity === "high" || b.severity === "critical" ? "failed" : "open"} label={b.severity} />
            <span className="min-w-0 flex-1">{b.title}</span>
            <ResolveRecord id={b.id} kind="bug" />
          </li>
        ))}
      {gaps
        .filter((g) => g.status === "open")
        .map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-1.5">
            <Mono className="text-xs">{g.id}</Mono>
            <Badge variant="outline">{g.category}</Badge>
            <span className="min-w-0 flex-1">{g.text}</span>
            <ResolveRecord id={g.id} kind="gap" />
          </li>
        ))}
    </ul>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>Tasks</span>
        <Mono>
          {done}/{total}
        </Mono>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sunk">
        <div className="h-full origin-left rounded-full bg-ok" style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  );
}

function TasksView({ tasks, ticket }: { tasks: Task[]; ticket: string }) {
  if (tasks.length === 0)
    return (
      <div className="flex flex-col gap-3">
        <EmptyState title="No tasks yet." hint="The planner slices the work into tasks once the spec is frozen, or add one here." />
        <AddBox label="Add a task">
          <TaskForm ticket={ticket} slices={["S1"]} />
        </AddBox>
      </div>
    );
  const slices = [...new Set(tasks.map((t) => t.slice))];
  const acs = [...new Set(tasks.flatMap((t) => t.acs))].sort();
  return (
    <div className="flex flex-col gap-4">
      <Progress done={tasks.filter((t) => t.status === "done").length} total={tasks.length} />
      {slices.map((s) => (
        <section key={s}>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Slice {s}</h3>
          <table className="w-full text-sm" aria-label={`Tasks in ${s}`}>
            <tbody>
              {tasks
                .filter((t) => t.slice === s)
                .map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="w-20 py-1.5 pr-2">
                      <Mono>{t.id}</Mono>
                    </td>
                    <td className="py-1.5 pr-2">{t.title}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline">{t.layer}</Badge>
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="flex flex-wrap gap-1">
                        {t.acs.map((a) => (
                          <Mono key={a} className="rounded bg-accent px-1 text-xs text-primary">
                            {a}
                          </Mono>
                        ))}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <TaskStatusToggle ticket={ticket} task={t} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <section>
        <AddBox label="Add a task">
          <TaskForm ticket={ticket} slices={slices} />
        </AddBox>
      </section>
      <section>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">AC trace</h3>
        {acs.length === 0 ? (
          <p className="text-sm text-warn">No task names an acceptance criterion yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" aria-label="AC trace">
            {acs.map((ac) => {
              const ts = tasks.filter((t) => t.acs.includes(ac));
              const done = ts.filter((t) => t.status === "done").length;
              return (
                <li key={ac} className="flex flex-wrap items-center gap-2">
                  <Mono className="w-14 text-primary">{ac}</Mono>
                  <span className="text-ink2">{ts.map((t) => t.id).join(", ")}</span>
                  <StatusChip status={done === ts.length ? "done" : "todo"} label={`${done}/${ts.length} done`} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Properties({ d, stageLabel }: { d: TicketDetail; stageLabel: (s: string) => string }) {
  const t = d.ticket as { links?: { related?: string[] }; flags?: { next_action?: string } };
  const rows: [string, ReactNode][] = [
    ["Stage", stageLabel(d.card.stage)],
    ["Size", d.card.size ?? "-"],
    ["Priority", d.card.priority],
    ["Owner", <Mono key="o">{d.card.owner ?? "-"}</Mono>],
    ["Project", d.card.project ?? "-"],
    ["Claimed by", d.digest.claim ? <Mono key="c">{d.digest.claim.by}</Mono> : "-"],
    ["Blocked by", d.card.blocked_by ?? (d.card.blocked ? "yes" : "none")],
    ["Next action", d.digest.blocked.next ?? t.flags?.next_action ?? "-"],
    [
      "Tasks",
      <Mono key="t">
        {d.card.tasks.done}/{d.card.tasks.total}
      </Mono>,
    ],
    ["Updated", fmtDateTime(d.card.updated)],
  ];
  const related = t.links?.related ?? [];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <section aria-label="Ticket actions" className="flex flex-col gap-3">
        <ClaimControl detail={d} />
        <BlockControl detail={d} />
        <FieldsEditor detail={d} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Properties</h2>
        <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Links</h2>
        {related.length === 0 ? (
          <p className="text-muted-foreground">No related tickets.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {related.map((r) => (
              <li key={r}>
                <Link to={`/t/${encodeURIComponent(r)}`} className="font-mono text-primary hover:underline">
                  {r}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {d.digest.next.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Next</h2>
          <ul className="list-disc pl-5 text-ink2">
            {d.digest.next.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TicketHeader({ d, crumbs }: { d: TicketDetail; crumbs: { label: ReactNode; to?: string }[] }) {
  return (
    <>
      <Crumbs items={crumbs} />
      <div className="mb-2 flex flex-wrap items-start gap-2">
        <h1 className="mr-auto text-lg font-semibold">
          <Mono className="mr-2">{d.card.id}</Mono>
          {d.card.title}
        </h1>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(d.card.id).catch(() => {})} aria-label="Copy ticket id">
          <Copy />
          Copy id
        </Button>
      </div>
      <TicketChips card={d.card} />
    </>
  );
}

const TABS = ["overview", "thread", "runs", "decisions", "questions", "tasks", "files"] as const;
type Tab = (typeof TABS)[number];

export function TicketPage() {
  const { id = "" } = useParams();
  const q = useTicket(id);
  const runs = useRuns();
  const stageLabel = useStageLabel();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview";
  const showTab = (v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === "overview") n.delete("tab");
        else n.set("tab", v);
        return n;
      },
      { replace: true },
    );

  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <div className="p-4">
        <ErrorState error={q.error} />
      </div>
    );
  const d = q.data;
  const decisions = byKind<DecisionRecord>(d, "decision");
  const questions = byKind<QuestionRecord>(d, "question");
  const bugs = byKind<BugRecord>(d, "bug");
  const gaps = byKind<GapRecord>(d, "gap");
  const ticketRuns = (runs.data ?? []).filter((r) => r.ticket === d.card.id);
  const openQ = questions.filter((x) => x.status === "open").length;

  return (
    <PageLayout id="ticket" rightTitle="Properties" right={<Properties d={d} stageLabel={stageLabel} />}>
      <TicketHeader d={d} crumbs={[{ label: "Tickets", to: "/tickets" }, { label: d.card.id }]} />
      <div className="mt-3">
        <MoveControls detail={d} stageLabel={stageLabel} />
      </div>
      <NextStepBar className="mt-3" ticket={d.card.id} onHandedOff={() => showTab("thread")} />
      <Tabs className="mt-3" value={tab} onValueChange={showTab}>
        <TabsList aria-label="Ticket sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="thread">Thread {d.comments.length}</TabsTrigger>
          <TabsTrigger value="runs">Runs {ticketRuns.length}</TabsTrigger>
          <TabsTrigger value="decisions">Decisions {decisions.length}</TabsTrigger>
          <TabsTrigger value="questions">Questions {openQ}</TabsTrigger>
          <TabsTrigger value="tasks">Tasks {d.tasks.length}</TabsTrigger>
          <TabsTrigger value="files">Files {d.artifacts.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
            <Card className="@2xl:col-span-2">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {d.digest.ticket.goal ? (
                  <p>{d.digest.ticket.goal}</p>
                ) : (
                  <EmptyState
                    title="No goal written yet."
                    hint="The spec file holds the full summary; open it from Files. Set a goal with Edit in Properties."
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <Progress done={d.card.tasks.done} total={d.card.tasks.total} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <DecisionsTable decisions={decisions} />
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Open questions</CardTitle>
              </CardHeader>
              <CardContent>
                <QuestionsList questions={questions} onlyOpen />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Bugs and gaps</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <BugsAndGaps bugs={bugs} gaps={gaps} />
                <AddBox label="Add a bug">
                  <BugForm ticket={d.card.id} />
                </AddBox>
                <AddBox label="Add a gap">
                  <GapForm ticket={d.card.id} />
                </AddBox>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <FileList ticket={d.card.id} artifacts={d.artifacts} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="thread">
          <TicketThreadView ticket={d.card.id} showNext={false} />
        </TabsContent>
        <TabsContent value="runs">{runs.isError ? <ErrorState error={runs.error} /> : <RunsTable runs={ticketRuns} />}</TabsContent>
        <TabsContent value="decisions" className="flex flex-col gap-3">
          <DecisionsTable decisions={decisions} />
          <AddBox label="Add a decision">
            <DecisionForm ticket={d.card.id} />
          </AddBox>
        </TabsContent>
        <TabsContent value="questions" className="flex flex-col gap-3">
          <QuestionsList questions={questions} />
          <AddBox label="Ask a question">
            <QuestionForm ticket={d.card.id} />
          </AddBox>
        </TabsContent>
        <TabsContent value="tasks">
          <TasksView tasks={d.tasks} ticket={d.card.id} />
        </TabsContent>
        <TabsContent value="files">
          <FileList ticket={d.card.id} artifacts={d.artifacts} />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

/** /t/:id/:artifact — the artifact index drives both this viewer and the palette (F148). */
export function ArtifactPage() {
  const { id = "", artifact = "" } = useParams();
  const t = useTicket(id);
  const a = useArtifact(id, artifact);
  const ref = a.data?.ref ?? t.data?.artifacts.find((x) => x.id === artifact);

  return (
    <PageLayout
      id="artifact"
      rightTitle="Files"
      right={
        t.data ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold">Files of {id}</h2>
            <FileList ticket={id} artifacts={t.data.artifacts} />
          </div>
        ) : undefined
      }
    >
      <Crumbs items={[{ label: "Tickets", to: "/tickets" }, { label: id, to: `/t/${encodeURIComponent(id)}` }, { label: ref?.title ?? artifact }]} />
      {ref && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            {ref.kind}
          </Badge>
          <Mono>{ref.path}</Mono>
          <span>{fmtBytes(ref.size)}</span>
        </div>
      )}
      {a.isPending ? <Loading label="Opening file" /> : a.isError ? <ErrorState error={a.error} /> : <ArtifactViewer content={a.data} />}
    </PageLayout>
  );
}
