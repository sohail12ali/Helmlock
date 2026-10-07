import type { ArtifactRef, QuestionRecord, TicketCard, TicketDetail } from "@helmlock/core/contracts";
import { AlertTriangle, ExternalLink, FileText, MessageCircleQuestion } from "lucide-react";
import { Link } from "react-router";
import { useTicket } from "@/api/hooks";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, StatusChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/** next_gate as "Move to <stage>: blocked by ..." plus the `hl ticket move` command to copy (read-only console). */
export function GateNotice({ detail, stageLabel }: { detail: TicketDetail; stageLabel: (id: string) => string }) {
  const g = detail.next_gate;
  if (!g) return null;
  const cmd = `hl ticket move ${detail.card.id} ${g.to}`;
  const label = stageLabel(g.to);
  if (g.gate.allowed)
    return (
      <div className="rounded-md border border-ok/40 bg-ok/5 p-3 text-sm">
        <p className="mb-2">
          <span className="font-medium">Move to {label}</span>: ready, every gate passes.
        </p>
        <CopyCommand command={cmd} />
      </div>
    );
  return (
    <div className="rounded-md border border-warn/50 bg-warn/5 p-3 text-sm" data-testid="gate-notice">
      <p className="mb-1 font-medium">
        Move to {label}: blocked by {g.gate.reasons.map((r) => r.message).join("; ")}
      </p>
      <ul className="mb-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
        {g.gate.reasons.map((r) => (
          <li key={r.rule + r.message}>
            <Mono>{r.rule}</Mono>
            {r.fix && <> — fix: {r.fix}</>}
          </li>
        ))}
      </ul>
      <CopyCommand command={cmd} label="When clear" />
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
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="questions">Questions {questions.length}</TabsTrigger>
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
        <TabsContent value="questions">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open questions.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {questions.map((r) => (
                <li key={r.id} className="flex gap-2">
                  <MessageCircleQuestion className={r.blocking ? "size-4 shrink-0 text-destructive" : "size-4 shrink-0 text-warn"} />
                  <span>
                    <Mono className="text-xs">{r.id}</Mono> {r.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="files">
          <FileList ticket={d.card.id} artifacts={d.artifacts} />
        </TabsContent>
      </Tabs>
      <GateNotice detail={d} stageLabel={stageLabel} />
      <Button asChild variant="default" className="self-start">
        <Link to={`/t/${encodeURIComponent(d.card.id)}`}>
          <ExternalLink />
          Open page
        </Link>
      </Button>
    </div>
  );
}
