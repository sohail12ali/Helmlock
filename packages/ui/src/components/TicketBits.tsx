import type { ArtifactRef, QuestionRecord, TicketCard, TicketDetail } from "@helmlock/core/contracts";
import { AlertTriangle, ExternalLink, FileText } from "lucide-react";
import { Link } from "react-router";
import { useTicket } from "@/api/hooks";
import { QuestionCard, QuestionForm } from "@/components/actions/RecordActions";
import { TicketControls } from "@/components/actions/TicketControls";
import { EmptyState, ErrorState, Loading, Mono, StatusChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NextStepBar } from "@/features/thread/NextStep";
import { TicketThreadView } from "@/features/thread/TicketThread";
import { capitalize, fmtBytes } from "@/lib/format";

export function TicketChips({ card }: { card: TicketCard }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusChip status={card.stage} label={`Stage: ${capitalize(card.stage)}`} />
      {card.size && <Badge variant="outline">Size {card.size}</Badge>}
      {card.priority !== "normal" && <StatusChip status={card.priority} label={card.priority} />}
      {card.owner && (
        <Badge variant="outline">
          Owner <Mono>{card.owner}</Mono>
        </Badge>
      )}
      {card.blocked ? (
        <Badge variant="danger" title={card.blocked_by}>
          <AlertTriangle />
          Blocked{card.blocked_by ? `: ${card.blocked_by}` : ""}
        </Badge>
      ) : (
        <Badge variant="ok">Not blocked</Badge>
      )}
      {card.claimed_by && (
        <Badge variant="accent">
          Claimed by <Mono>{card.claimed_by}</Mono>
        </Badge>
      )}
    </div>
  );
}

export function artifactPath(ticket: string, a: ArtifactRef): string {
  return `/t/${encodeURIComponent(ticket)}/${encodeURIComponent(a.id)}`;
}

export function FileList({ ticket, artifacts }: { ticket: string; artifacts: ArtifactRef[] }) {
  if (artifacts.length === 0) return <EmptyState title="No files yet." hint="The spec is created when the analyst starts the ticket." />;
  return (
    <ul className="flex flex-col">
      {artifacts.map((a) => (
        <li key={a.id}>
          <Link to={artifactPath(ticket, a)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{a.title}</span>
            <Badge variant="outline" className="font-mono">
              {a.kind}
            </Badge>
            <Mono className="w-14 shrink-0 text-right text-xs text-muted-foreground">{fmtBytes(a.size)}</Mono>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function openQuestions(d: TicketDetail) {
  return d.records.filter((r): r is QuestionRecord & { kind: "question"; path: string } => r.kind === "question" && r.status === "open");
}

/** Right-panel drawer on the board (mockup 02). */
export function TicketDrawer({ id, stageLabel }: { id: string; stageLabel: (id: string) => string }) {
  const q = useTicket(id);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  const questions = openQuestions(d);
  return (
    <div className="flex flex-col gap-3" data-testid="ticket-drawer">
      <div>
        <Mono className="text-lg font-semibold">{d.card.id}</Mono>
        <p className="text-ink2">{d.card.title}</p>
      </div>
      <TicketChips card={d.card} />
      <TicketControls detail={d} stageLabel={stageLabel} />
      <NextStepBar ticket={d.card.id} />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="questions">Questions {questions.length}</TabsTrigger>
          <TabsTrigger value="thread">Thread {d.comments.length}</TabsTrigger>
          <TabsTrigger value="files">Files {d.artifacts.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="flex flex-col gap-2 text-sm">
          {d.digest.ticket.goal && <p>{d.digest.ticket.goal}</p>}
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">Priority</dt>
            <dd>{d.card.priority}</dd>
            <dt className="text-muted-foreground">Project</dt>
            <dd>{d.card.project ?? "-"}</dd>
            <dt className="text-muted-foreground">Tasks</dt>
            <dd>
              <Mono>
                {d.card.tasks.done}/{d.card.tasks.total}
              </Mono>
              {d.digest.tasks.next && <span className="text-muted-foreground"> next {d.digest.tasks.next}</span>}
            </dd>
            <dt className="text-muted-foreground">Open bugs</dt>
            <dd>
              <Mono>{d.card.open_bugs}</Mono>
            </dd>
          </dl>
          {d.digest.next.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Next</p>
              <ul className="list-disc pl-5">
                {d.digest.next.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>
        <TabsContent value="questions" className="flex flex-col gap-2">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open questions.</p>
          ) : (
            questions.map((r) => <QuestionCard key={r.id} q={r} />)
          )}
          <details className="rounded-md border p-2 text-sm">
            <summary className="cursor-pointer text-ink2">Ask a question</summary>
            <div className="mt-2">
              <QuestionForm ticket={d.card.id} />
            </div>
          </details>
        </TabsContent>
        <TabsContent value="thread">
          <TicketThreadView ticket={d.card.id} showNext={false} />
        </TabsContent>
        <TabsContent value="files">
          <FileList ticket={d.card.id} artifacts={d.artifacts} />
        </TabsContent>
      </Tabs>
      <Button asChild variant="outline" className="self-start">
        <Link to={`/t/${encodeURIComponent(d.card.id)}`}>
          <ExternalLink />
          Open page
        </Link>
      </Button>
    </div>
  );
}
