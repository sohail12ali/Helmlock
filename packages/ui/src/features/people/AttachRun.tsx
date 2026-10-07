// "Attach to ticket" (Blueprint 31): a run record is Private (this machine) by default. Attaching copies the run
// record and a short transcript into the ticket folder, committed to git. Verb: run attach <run> <ticket>.
import { Paperclip } from "lucide-react";
import { useId, useState } from "react";
import { INVALIDATE_M6, useTicketList } from "@/api/m6";
import { TicketLink } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";

export function AttachRun({ runId, defaultTicket }: { runId: string; defaultTicket?: string }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [ticket, setTicket] = useState(defaultTicket ?? "");
  const [attached, setAttached] = useState<string>();
  const tickets = useTicketList();
  const v = useVerbRun("run attach", INVALIDATE_M6.runs);
  if (!open)
    return (
      <span className="flex items-center gap-2 text-xs">
        {attached && (
          <span role="status" className="text-ok">
            Attached to <TicketLink id={attached} />
          </span>
        )}
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Paperclip /> Attach to ticket
        </Button>
      </span>
    );
  const list = tickets.data ?? [];
  return (
    <form
      aria-label="Attach to ticket"
      className="flex w-full flex-col gap-2 rounded-md border bg-sunk p-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ticket) return;
        const r = await v.run({ run: runId, ticket });
        if (r.ok) {
          setAttached(ticket);
          setOpen(false);
        }
      }}
    >
      <p>
        Copies this run's record and a short transcript into the ticket folder. It is <strong>committed to git</strong> and visible to the team. The full run
        log stays Private on this machine.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ticket" htmlFor={`${uid}-ticket`} className="min-w-48 flex-1">
          <Select id={`${uid}-ticket`} value={ticket} onChange={(e) => setTicket(e.target.value)} disabled={tickets.isPending}>
            <option value="">{tickets.isPending ? "Loading tickets…" : "Pick a ticket"}</option>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
            {ticket && !list.some((t) => t.id === ticket) && <option value={ticket}>{ticket}</option>}
          </Select>
        </Field>
        <Button type="submit" size="sm" disabled={!ticket || v.pending}>
          {v.pending ? "Attaching" : "Attach"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {v.last && !v.last.result.ok && <VerbResult result={v.last.result} />}
    </form>
  );
}
