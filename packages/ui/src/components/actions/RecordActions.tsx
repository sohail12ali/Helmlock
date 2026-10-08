// Record and task writes on a ticket: comment, question (ask + answer card, F133), decision, bug, gap, task.
import type { QuestionRecord, Task, TicketDetail } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircleQuestion, Send } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { keys, useTicket } from "@/api/hooks";
import { Mono } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Kbd } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ActionForm, Field, LAYERS, SEVERITIES, Select, TASK_STATUSES, Textarea } from "./fields";
import { ActionError } from "./result";
import { splitList, useAction } from "./use-action";

/** Comment box for the Thread tab; Ctrl+Enter (or Cmd+Enter) sends. */
export function CommentBox({ ticket }: { ticket: string }) {
  const action = useAction("ticket comment");
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim() || action.pending) return;
    const r = await action.run({ id: ticket, text: text.trim() });
    if (r.ok) setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <form
      aria-label="Comment"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Textarea aria-label="Comment text" placeholder="Write a comment" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!text.trim() || action.pending}>
          <Send />
          {action.pending ? "Sending…" : "Comment"}
        </Button>
        <span className="text-xs text-muted-foreground">
          <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> sends
        </span>
      </div>
      <ActionError result={action.failure} />
    </form>
  );
}

type Question = Pick<QuestionRecord, "id" | "text" | "blocking" | "options"> & Partial<Pick<QuestionRecord, "ticket">>;

/** An open question as a card (F133): options as buttons, or a free-text answer. Answering resumes the work. */
export function QuestionCard({ q, ticket, compact = false }: { q: Question; ticket?: string; compact?: boolean }) {
  const action = useAction("question answer");
  const [text, setText] = useState("");
  const answer = async (a: string) => {
    if (!a.trim() || action.pending) return;
    const r = await action.run({ id: q.id, answer: a.trim() });
    if (r.ok) setText("");
  };
  return (
    <article
      aria-label={`Question ${q.id}`}
      className={cn("rounded-md border bg-card p-3 text-sm", q.blocking ? "border-l-2 border-l-destructive" : "border-l-2 border-l-warn")}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <MessageCircleQuestion className={cn("size-4 shrink-0", q.blocking ? "text-destructive" : "text-warn")} aria-hidden />
        <Mono className="text-xs">{q.id}</Mono>
        {(ticket ?? q.ticket) && <Mono className="text-xs text-primary">{ticket ?? q.ticket}</Mono>}
        {q.blocking && <Badge variant="danger">blocking</Badge>}
      </div>
      {!compact && <p className="mt-1">{q.text}</p>}
      {q.options.length > 0 && (
        <fieldset className="mt-2 flex flex-wrap gap-1.5" aria-label="Options">
          {q.options.map((o) => (
            <Button key={o} size="sm" variant="outline" disabled={action.pending} onClick={() => void answer(o)}>
              {o}
            </Button>
          ))}
        </fieldset>
      )}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void answer(text);
        }}
      >
        <Input
          aria-label={`Answer ${q.id}`}
          placeholder={q.options.length ? "Or write an answer" : "Write an answer"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim() || action.pending} className="h-8">
          Answer
        </Button>
      </form>
      <ActionError result={action.failure} className="mt-2" />
    </article>
  );
}

export function QuestionForm({ ticket }: { ticket: string }) {
  const action = useAction("question add");
  const [text, setText] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [options, setOptions] = useState("");
  return (
    <ActionForm
      label="Ask a question"
      action={action}
      submitLabel="Ask"
      canSubmit={!!text.trim()}
      input={() => ({ ticket, text: text.trim(), blocking, option: splitList(options) })}
      onDone={() => {
        setText("");
        setOptions("");
        setBlocking(false);
      }}
    >
      <Field label="Question">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Which catalog holds gift cards?" />
      </Field>
      <Field label="Options (comma separated, optional)">
        <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="WMS, AMS" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
        Blocking (stops the ticket leaving spec or plan until answered)
      </label>
    </ActionForm>
  );
}

export function DecisionForm({ ticket }: { ticket: string }) {
  const action = useAction("decision add");
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState("");
  const [why, setWhy] = useState("");
  const [rejected, setRejected] = useState("");
  return (
    <ActionForm
      label="Add a decision"
      action={action}
      submitLabel="Add decision"
      canSubmit={!!title.trim()}
      input={() => ({
        ticket,
        title: title.trim(),
        ...(chosen.trim() ? { chosen: chosen.trim() } : {}),
        ...(why.trim() ? { why: why.trim() } : {}),
        rejected: splitList(rejected),
      })}
      onDone={() => {
        setTitle("");
        setChosen("");
        setWhy("");
        setRejected("");
      }}
    >
      <Field label="Decision">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Where the balance lives" />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Chosen">
          <Input value={chosen} onChange={(e) => setChosen(e.target.value)} />
        </Field>
        <Field label="Rejected (comma separated)">
          <Input value={rejected} onChange={(e) => setRejected(e.target.value)} />
        </Field>
      </div>
      <Field label="Why">
        <Input value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
    </ActionForm>
  );
}

export function BugForm({ ticket }: { ticket: string }) {
  const action = useAction("bug add");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  return (
    <ActionForm
      label="Add a bug"
      action={action}
      submitLabel="Add bug"
      canSubmit={!!title.trim()}
      input={() => ({ ticket, title: title.trim(), severity })}
      onDone={() => setTitle("")}
    >
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <Field label="Bug">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Redeem twice succeeds" />
        </Field>
        <Field label="Severity">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
    </ActionForm>
  );
}

export function GapForm({ ticket }: { ticket: string }) {
  const action = useAction("gap add");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  return (
    <ActionForm
      label="Add a gap"
      action={action}
      submitLabel="Add gap"
      canSubmit={!!text.trim()}
      input={() => ({ ticket, text: text.trim(), ...(category.trim() ? { category: category.trim() } : {}) })}
      onDone={() => {
        setText("");
        setCategory("");
      }}
    >
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <Field label="Gap">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="No rule for expired cards" />
        </Field>
        <Field label="Category">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="rules" />
        </Field>
      </div>
    </ActionForm>
  );
}

/** Resolve a bug (optional "fixed in") or close a gap (optional note), inline on its row. */
export function ResolveRecord({ id, kind }: { id: string; kind: "bug" | "gap" }) {
  const action = useAction(kind === "bug" ? "bug resolve" : "gap resolve");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Resolve ${id}`}>
        <CheckCircle2 />
        Resolve
      </Button>
    );
  const key = kind === "bug" ? "fixed-in" : "note";
  return (
    <ActionForm
      label={`Resolve ${id}`}
      action={action}
      preview={false}
      submitLabel={kind === "bug" ? "Mark fixed" : "Close gap"}
      input={() => ({ id, ...(note.trim() ? { [key]: note.trim() } : {}) })}
      onDone={() => setOpen(false)}
      className="w-full"
    >
      <Field label={kind === "bug" ? "Fixed in (optional)" : "How it was closed (optional)"}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "bug" ? "commit 1a2b3c" : "Rule added as AC-4"} />
      </Field>
    </ActionForm>
  );
}

export function TaskForm({ ticket, slices }: { ticket: string; slices: string[] }) {
  const action = useAction("task add");
  const [title, setTitle] = useState("");
  const [slice, setSlice] = useState(slices[0] ?? "S1");
  const [layer, setLayer] = useState<string>("api");
  const [acs, setAcs] = useState("");
  return (
    <ActionForm
      label="Add a task"
      action={action}
      submitLabel="Add task"
      canSubmit={!!title.trim() && /^S\d+$/.test(slice)}
      input={() => ({ ticket, title: title.trim(), slice, layer, ac: splitList(acs) })}
      onDone={() => {
        setTitle("");
        setAcs("");
      }}
    >
      <Field label="Task">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Redeem endpoint" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Slice">
          <Input value={slice} onChange={(e) => setSlice(e.target.value.toUpperCase())} list="hl-slices" placeholder="S1" />
          <datalist id="hl-slices">
            {slices.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Layer">
          <Select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="ACs (comma separated)">
          <Input value={acs} onChange={(e) => setAcs(e.target.value)} placeholder="AC-1, AC-2" />
        </Field>
      </div>
    </ActionForm>
  );
}

/** A needs-you question (Overview, Inbox) as an answer card; options come from the ticket's question record. */
export function NeedsYouQuestionCard({ ticket, id, text }: { ticket: string; id: string; text: string }) {
  const t = useTicket(ticket);
  const rec = t.data?.records.find((r) => r.kind === "question" && r.id === id) as QuestionRecord | undefined;
  if (rec && rec.status !== "open") return null;
  return <QuestionCard q={{ id, text, blocking: rec?.blocking ?? false, options: rec?.options ?? [] }} ticket={ticket} compact />;
}

/** Task status: optimistic (the only optimistic write); rolls back and shows the failure if the server refuses. */
export function TaskStatusToggle({ ticket, task }: { ticket: string; task: Task }) {
  const action = useAction("task set");
  const qc = useQueryClient();
  const set = async (status: Task["status"]) => {
    const key = keys.ticket(ticket);
    const before = qc.getQueryData<TicketDetail>(key);
    if (before) qc.setQueryData<TicketDetail>(key, { ...before, tasks: before.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) });
    const r = await action.run({ ticket, task: task.id, status });
    if (!r.ok && before) qc.setQueryData(key, before);
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Select
        aria-label={`Status of ${task.id}`}
        value={task.status}
        data-status={task.status}
        onChange={(e) => void set(e.target.value as Task["status"])}
        className="h-7 w-24 text-xs"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </Select>
      <ActionError result={action.failure} className="max-w-72 text-left" onDismiss={action.reset} />
    </span>
  );
}
