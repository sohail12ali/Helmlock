// Ticket state actions for the drawer and the ticket page: move, claim/release, block/unblock, edit size/priority/title.
import type { TicketDetail } from "@helmlock/core/contracts";
import { ArrowRight, ChevronDown, Lock, LockOpen, Pencil, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBoard, useWorkspace } from "@/api/hooks";
import { Mono } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm, Field, PRIORITIES, Select, SIZES } from "./fields";
import { ActionError } from "./result";
import { useAction } from "./use-action";

/** The stage after `stage` in the workflow pack's order (undefined at the end). */
export function nextStage(stages: { id: string }[], stage: string): string | undefined {
  const i = stages.findIndex((s) => s.id === stage);
  return i >= 0 ? stages[i + 1]?.id : undefined;
}

/** A plain disclosure menu of stages (no popper library): Escape or a click outside closes it. */
function StageMenu({ stages, disabled, onPick }: { stages: { id: string; label: string }[]; disabled: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" disabled={disabled} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        Move to stage
        <ChevronDown />
      </Button>
      {open && (
        <ul aria-label="Stages" className="absolute top-full left-0 z-50 mt-1 flex min-w-40 flex-col rounded-md border bg-popover p-1 shadow-md">
          {stages.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                // biome-ignore lint/a11y/noAutofocus: focus the first stage when the menu opens
                autoFocus={i === 0}
                className="w-full rounded px-2 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  setOpen(false);
                  onPick(s.id);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Move to <next>" plus a menu of every other stage: the keyboard alternative to dragging a card. */
export function MoveControls({ detail, stageLabel }: { detail: TicketDetail; stageLabel: (id: string) => string }) {
  const board = useBoard();
  const action = useAction("ticket move");
  const stages = board.data?.stages ?? [];
  const id = detail.card.id;
  const next = detail.next_gate?.to ?? nextStage(stages, detail.card.stage);
  const gate = detail.next_gate?.gate;
  const move = (stage: string) => void action.run({ id, stage });

  return (
    <div className="flex flex-col gap-2" data-testid="move-controls">
      <div className="flex flex-wrap items-center gap-1.5">
        {next && (
          <Button size="sm" onClick={() => move(next)} disabled={action.pending}>
            <ArrowRight />
            Move to {stageLabel(next)}
          </Button>
        )}
        {stages.length > 1 && <StageMenu stages={stages.filter((x) => x.id !== detail.card.stage)} disabled={action.pending} onPick={move} />}
        {action.pending && <span className="text-xs text-muted-foreground">Moving…</span>}
      </div>
      {gate && next && !action.failure && (
        <div
          className={gate.allowed ? "rounded-md border border-ok/40 bg-ok/5 p-2 text-xs" : "rounded-md border border-warn/50 bg-warn/5 p-2 text-xs"}
          data-testid="gate-notice"
        >
          {gate.allowed ? (
            <p>
              <span className="font-medium">Move to {stageLabel(next)}</span>: ready, every gate passes.
            </p>
          ) : (
            <>
              <p className="font-medium">
                Move to {stageLabel(next)}: blocked by {gate.reasons.map((r) => r.message).join("; ")}
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-muted-foreground">
                {gate.reasons.map((r) => (
                  <li key={r.rule + r.message}>
                    <Mono>{r.rule}</Mono>
                    {r.fix && (
                      <>
                        {" "}
                        — fix: <Mono className="text-foreground">{r.fix}</Mono>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <ActionError result={action.failure} onDismiss={action.reset} />
    </div>
  );
}

/** Who holds the ticket, and Claim or Release. A claim held by someone else comes back as claim-conflict, shown inline. */
export function ClaimControl({ detail }: { detail: TicketDetail }) {
  const ws = useWorkspace();
  const me = ws.data?.author?.id;
  const holder = detail.digest.claim?.by ?? detail.card.claimed_by;
  const mine = !!holder && holder === me;
  const claim = useAction("ticket claim");
  const release = useAction("ticket release");
  const a = mine ? release : claim;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Claim</span>
        {holder ? (
          <span>
            held by <Mono>{holder}</Mono>
            {mine && " (you)"}
          </span>
        ) : (
          <span className="text-muted-foreground">nobody</span>
        )}
        <Button size="sm" variant="outline" className="ml-auto" disabled={a.pending} onClick={() => void a.run({ id: detail.card.id })}>
          {mine ? <LockOpen /> : <Lock />}
          {mine ? "Release" : "Claim"}
        </Button>
      </div>
      <ActionError
        result={claim.failure ?? release.failure}
        onDismiss={() => {
          claim.reset();
          release.reset();
        }}
      />
    </div>
  );
}

/** Block needs who or what blocks it and the next action; unblock clears the flag. */
export function BlockControl({ detail }: { detail: TicketDetail }) {
  const block = useAction("ticket block");
  const unblock = useAction("ticket unblock");
  const [editing, setEditing] = useState(false);
  const [by, setBy] = useState("");
  const [next, setNext] = useState("");
  const id = detail.card.id;

  if (detail.card.blocked)
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ShieldAlert className="size-4 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1">
            Blocked{detail.card.blocked_by ? ` by ${detail.card.blocked_by}` : ""}
            {detail.digest.blocked.next && <span className="block text-xs text-muted-foreground">Next: {detail.digest.blocked.next}</span>}
          </span>
          <Button size="sm" variant="outline" disabled={unblock.pending} onClick={() => void unblock.run({ id })}>
            <ShieldCheck />
            Unblock
          </Button>
        </div>
        <ActionError result={unblock.failure} onDismiss={unblock.reset} />
      </div>
    );

  if (!editing)
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Not blocked</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
          <ShieldAlert />
          Block…
        </Button>
      </div>
    );

  return (
    <ActionForm
      label="Block ticket"
      action={block}
      preview={false}
      submitLabel="Block"
      canSubmit={by.trim().length > 0 && next.trim().length > 0}
      input={() => ({ id, by: by.trim(), next: next.trim() })}
      onDone={() => {
        setEditing(false);
        setBy("");
        setNext("");
      }}
    >
      <Field label="Blocked by (who or what)">
        <Input value={by} onChange={(e) => setBy(e.target.value)} placeholder="DBA review" />
      </Field>
      <Field label="Next action">
        <Input value={next} onChange={(e) => setNext(e.target.value)} placeholder="Ask Kim to approve the table" />
      </Field>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => {
          setEditing(false);
          block.reset();
        }}
      >
        Cancel
      </Button>
    </ActionForm>
  );
}

/** Edit title, goal, size and priority; only changed keys are sent to `ticket set`. */
export function FieldsEditor({ detail }: { detail: TicketDetail }) {
  const action = useAction("ticket set");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(detail.card.title);
  const [size, setSize] = useState<string>(detail.card.size ?? "");
  const [priority, setPriority] = useState(detail.card.priority);
  const [goal, setGoal] = useState(detail.digest.ticket.goal ?? "");
  const c = detail.card;
  const oldGoal = detail.digest.ticket.goal ?? "";

  if (!editing)
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => {
          setTitle(c.title);
          setSize(c.size ?? "");
          setPriority(c.priority);
          setGoal(oldGoal);
          setEditing(true);
        }}
      >
        <Pencil />
        Edit
      </Button>
    );

  const changes = {
    ...(title.trim() && title.trim() !== c.title ? { title: title.trim() } : {}),
    ...(size && size !== c.size ? { size } : {}),
    ...(priority !== c.priority ? { priority } : {}),
    ...(goal.trim() && goal.trim() !== oldGoal ? { goal: goal.trim() } : {}),
  };
  return (
    <ActionForm
      label="Edit ticket"
      action={action}
      preview={false}
      submitLabel="Save"
      canSubmit={Object.keys(changes).length > 0}
      input={() => ({ id: c.id, ...changes })}
      onDone={() => setEditing(false)}
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Goal (one sentence)">
        <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Size">
          <Select value={size} onChange={(e) => setSize(e.target.value)}>
            {!c.size && <option value="">-</option>}
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => {
          setEditing(false);
          action.reset();
        }}
      >
        Cancel
      </Button>
    </ActionForm>
  );
}

/** Everything that changes the ticket's state, stacked for the drawer and the ticket page's side panel. */
export function TicketControls({ detail, stageLabel }: { detail: TicketDetail; stageLabel: (id: string) => string }) {
  return (
    <section aria-label="Ticket actions" className="flex flex-col gap-3">
      <MoveControls detail={detail} stageLabel={stageLabel} />
      <ClaimControl detail={detail} />
      <BlockControl detail={detail} />
      <FieldsEditor detail={detail} />
    </section>
  );
}
