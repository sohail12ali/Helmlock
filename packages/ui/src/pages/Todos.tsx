// Todos (F8a, F8b): a light list, general inbox or ticket-scoped, with priority and due date. Writes: todo add, todo done.
import type { TodoItem } from "@helmlock/core/api";
import { useId, useState } from "react";
import { INVALIDATE, useTodos } from "@/api/write-hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader, StatusChip, TicketLink } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isoLocal } from "@/lib/dates";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Open first, then by due date (none last), then priority, then oldest first. */
export function sortTodos(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort(
    (a, b) =>
      (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) ||
      a.created.localeCompare(b.created),
  );
}

type Filter = "open" | "done";

function QuickAdd() {
  const uid = useId();
  const [text, setText] = useState("");
  const [ticket, setTicket] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const v = useVerbRun("todo add", INVALIDATE.todos);
  const submit = async () => {
    if (!text.trim()) return;
    const input: Record<string, unknown> = { text: text.trim() };
    if (ticket.trim()) input.ticket = ticket.trim();
    if (due) input.due = due;
    if (priority !== "normal") input.priority = priority;
    const r = await v.run(input);
    if (r.ok) {
      setText("");
      setDue("");
      setPriority("normal");
    }
  };
  return (
    <Card className="mb-3 p-3">
      <form
        aria-label="Add a todo"
        className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_7rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Todo" htmlFor={`${uid}-text`} required>
          <Input id={`${uid}-text`} value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs doing" />
        </Field>
        <Field label="Ticket" htmlFor={`${uid}-ticket`}>
          <Input id={`${uid}-ticket`} value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="optional" className="font-mono" />
        </Field>
        <Field label="Due" htmlFor={`${uid}-due`}>
          <Input id={`${uid}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor={`${uid}-priority`}>
          <Select id={`${uid}-priority`} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" size="default" disabled={v.pending || !text.trim()}>
          Add
        </Button>
      </form>
      <VerbResult className="mt-2" result={v.last?.result} />
    </Card>
  );
}

function TodoRow({ t, today }: { t: TodoItem; today: string }) {
  const v = useVerbRun("todo done", INVALIDATE.todos);
  const done = t.status === "done";
  const overdue = !done && !!t.due && t.due < today;
  return (
    <li className="flex flex-col gap-1 py-2" data-todo={t.id}>
      <div className="flex min-w-0 items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={done}
          disabled={done || v.pending}
          aria-label={done ? `Done: ${t.text}` : `Mark done: ${t.text}`}
          onChange={() => void v.run({ id: t.id })}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={done ? "text-muted-foreground line-through" : ""}>{t.text}</span>
          {t.ticket && <TicketLink id={t.ticket} className="text-xs" />}
          {t.priority !== "normal" && <StatusChip status={t.priority} />}
          {t.due && (
            <span className={overdue ? "text-xs font-medium text-warn" : "text-xs text-muted-foreground"}>
              {overdue ? "overdue " : "due "}
              <Mono>{t.due}</Mono>
            </span>
          )}
          <Mono className="ml-auto text-xs text-muted-foreground">{t.id}</Mono>
        </div>
      </div>
      {v.last && !v.last.result.ok && <VerbResult result={v.last.result} className="ml-6.5" />}
    </li>
  );
}

export function TodosPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const q = useTodos({ status: filter });
  const today = isoLocal(new Date());
  const items = q.data ? sortTodos(q.data) : [];
  return (
    <PageLayout id="todos">
      <PageHeader title="Todos">
        <fieldset className="flex gap-1" aria-label="Show">
          {(["open", "done"] as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "secondary" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "open" ? "Open" : "Done"}
            </Button>
          ))}
        </fieldset>
      </PageHeader>
      <div className="w-full">
        <QuickAdd />
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : items.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "Nothing open. Add a todo above." : "No done todos yet."}
            hint="A todo is a light note to self: general, or tied to a ticket, with an optional due date and priority."
            command='hl todo add "<text>"'
          />
        ) : (
          <Card className="px-3 py-1">
            <ul className="divide-y text-sm" aria-label={filter === "open" ? "Open todos" : "Done todos"}>
              {items.map((t) => (
                <TodoRow key={t.id} t={t} today={today} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
