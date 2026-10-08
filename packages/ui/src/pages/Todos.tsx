// Todos (F8a, F8b, Blueprint 31): a light list, general inbox or ticket-scoped, with priority, due date and a storage
// scope (Team, Personal, Private). Writes: todo add (with scope), todo done, todo move. Other people's personal
// todos are shown read-only under "Everyone's".
import type { TodoItem } from "@helmlock/core/api";
import { useId, useState } from "react";
import { useBoard } from "@/api/hooks";
import { INVALIDATE_M6, usePeople, useScopedTodos } from "@/api/m6";
import { INVALIDATE } from "@/api/write-hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader, StatusChip, TicketLink } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SCOPE_ORDER, SCOPES, type Scope, ScopeBadge, ScopePicker } from "@/features/people/scope";
import { inProject, useActiveProject } from "@/features/projects/active";
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

type Status = "open" | "done";
export type ScopeFilter = "all" | "team" | "mine" | "private" | "everyone";
const FILTERS: { id: ScopeFilter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Team todos and yours (personal and private)" },
  { id: "team", label: "Team", hint: "Shared with the team, committed" },
  { id: "mine", label: "Mine", hint: "Your personal and private todos" },
  { id: "private", label: "Private", hint: "Only on this machine" },
  { id: "everyone", label: "Everyone's", hint: "Adds other people's personal todos (read-only)" },
];

/** Another person's personal todo: visible to you (committed) but not yours to change. Without a known "me" every
 *  personal todo the server returns is treated as yours. */
export const isOthers = (t: TodoItem, me: string | undefined) => t.scope === "personal" && !!me && t.author !== me;

export function filterTodos(items: readonly TodoItem[], f: ScopeFilter, me: string | undefined): TodoItem[] {
  const keep: Record<ScopeFilter, (t: TodoItem) => boolean> = {
    all: (t) => !isOthers(t, me),
    team: (t) => t.scope === "team",
    mine: (t) => (t.scope === "personal" && !isOthers(t, me)) || t.scope === "private",
    private: (t) => t.scope === "private",
    everyone: () => true,
  };
  return items.filter(keep[f]);
}

type SectionId = Scope | "others";
/** Sections in scope order; other people's personal todos last. */
export function groupTodos(items: readonly TodoItem[], me: string | undefined): { id: SectionId; items: TodoItem[] }[] {
  const order: SectionId[] = [...SCOPE_ORDER, "others"];
  const by = new Map<SectionId, TodoItem[]>(order.map((id) => [id, []]));
  for (const t of sortTodos(items)) by.get(isOthers(t, me) ? "others" : t.scope)!.push(t);
  return order.map((id) => ({ id, items: by.get(id)! })).filter((s) => s.items.length > 0);
}

function QuickAdd({ me }: { me?: string }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [ticket, setTicket] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const [scope, setScope] = useState<Scope>("personal");
  const v = useVerbRun("todo add", INVALIDATE.todos);
  const submit = async () => {
    if (!text.trim()) return;
    const input: Record<string, unknown> = { text: text.trim() };
    if (ticket.trim()) input.ticket = ticket.trim();
    if (due) input.due = due;
    if (priority !== "normal") input.priority = priority;
    input.scope = scope;
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
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_7rem_auto] sm:items-end">
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
        </div>
        <ScopePicker value={scope} onChange={setScope} me={me} label="Keep this todo" />
      </form>
      <VerbResult className="mt-2" result={v.last?.result} />
    </Card>
  );
}

function MoveMenu({ t, me }: { t: TodoItem; me?: string }) {
  const v = useVerbRun("todo move", INVALIDATE_M6.todos);
  return (
    <>
      <Select
        aria-label={`Move to…: ${t.text}`}
        className="h-7 w-auto text-xs"
        value=""
        disabled={v.pending}
        onChange={(e) => {
          const scope = e.target.value as Scope;
          if (scope) void v.run({ id: t.id, scope });
        }}
      >
        <option value="">Move to…</option>
        {SCOPE_ORDER.filter((s) => s !== t.scope).map((s) => (
          <option key={s} value={s} title={SCOPES[s].where(me)}>
            {SCOPES[s].label}
          </option>
        ))}
      </Select>
      {v.last && !v.last.result.ok && <VerbResult result={v.last.result} className="w-full" />}
    </>
  );
}

function TodoRow({ t, today, me, readOnly, authorName }: { t: TodoItem; today: string; me?: string; readOnly: boolean; authorName?: string }) {
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
          disabled={done || v.pending || readOnly}
          aria-label={done ? `Done: ${t.text}` : readOnly ? `${t.text} (read-only)` : `Mark done: ${t.text}`}
          onChange={() => void v.run({ id: t.id })}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={done ? "text-muted-foreground line-through" : ""}>{t.text}</span>
          {t.ticket && <TicketLink id={t.ticket} className="text-xs" />}
          {t.priority !== "normal" && <StatusChip status={t.priority} />}
          {t.due && (
            <span className={overdue ? "text-xs font-medium text-warn" : "text-xs text-muted-foreground"}>
              {overdue ? "overdue " : "due "}
              <Mono>{t.due}</Mono>
            </span>
          )}
          <ScopeBadge scope={t.scope} me={readOnly ? t.author : me} label={readOnly ? `${authorName ?? t.author} · Personal` : undefined} />
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {!readOnly && !done && <MoveMenu t={t} me={me} />}
            <Mono className="text-xs text-muted-foreground">{t.id}</Mono>
          </span>
        </div>
      </div>
      {v.last && !v.last.result.ok && <VerbResult result={v.last.result} className="ml-6.5" />}
    </li>
  );
}

const SECTION_TITLE: Record<SectionId, string> = { team: "Team", personal: "Personal", private: "Private", others: "Other people's personal" };

export function TodosPage() {
  const [status, setStatus] = useState<Status>("open");
  const [filter, setFilter] = useState<ScopeFilter>("all");
  const people = usePeople();
  const me = people.data?.me?.id;
  const q = useScopedTodos({ status, all: filter === "everyone" });
  const today = isoLocal(new Date());
  // Active project (milestone 7): todos carry a ticket, not a project, so a todo is hidden only when its ticket is in
  // another project; todos with no ticket stay.
  const { project } = useActiveProject();
  const board = useBoard();
  const sections = q.data
    ? groupTodos(
        filterTodos(
          inProject(q.data, project, (t) => t.ticket, board.data?.tickets),
          filter,
          me,
        ),
        me,
      )
    : [];
  const names = new Map((people.data?.people ?? []).map((p) => [p.id, p.name]));
  return (
    <PageLayout id="todos">
      <PageHeader title="Todos">
        <fieldset className="flex gap-1" aria-label="Show">
          {(["open", "done"] as Status[]).map((f) => (
            <Button key={f} size="sm" variant={status === f ? "secondary" : "outline"} aria-pressed={status === f} onClick={() => setStatus(f)}>
              {f === "open" ? "Open" : "Done"}
            </Button>
          ))}
        </fieldset>
      </PageHeader>
      <div className="w-full">
        <QuickAdd me={me} />
        <fieldset className="mb-3 flex flex-wrap gap-1.5" aria-label="Whose todos">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              title={f.hint}
              onClick={() => setFilter(f.id)}
              className={
                filter === f.id
                  ? "rounded-full border border-primary bg-accent px-2.5 py-0.5 text-xs font-medium text-primary"
                  : "rounded-full border px-2.5 py-0.5 text-xs text-ink2 hover:bg-accent"
              }
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        {project && (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="todos-project-note">
            Project <Mono>{project}</Mono>: todos of its tickets, and todos with no ticket.
          </p>
        )}
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : sections.length === 0 ? (
          <EmptyState
            title={status === "open" ? "Nothing open. Add a todo above." : "No done todos yet."}
            hint="A todo is a light note: Team (shared, in git), Personal (in git under people/<you>, visible to the team) or Private (this machine only)."
            command='hl todo add "<text>" --scope personal'
          />
        ) : (
          <div className="flex flex-col gap-3" data-testid="todo-sections">
            {sections.map((s) => (
              <Card key={s.id} className="px-3 py-1" aria-labelledby={`todos-${s.id}`}>
                <h2 id={`todos-${s.id}`} className="flex items-center gap-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {SECTION_TITLE[s.id]}
                  <span className="font-normal normal-case">{s.id === "others" ? "read-only" : SCOPES[s.id].where(me)}</span>
                </h2>
                <ul className="divide-y text-sm" aria-label={`${SECTION_TITLE[s.id]} todos`}>
                  {s.items.map((t) => (
                    <TodoRow key={t.id} t={t} today={today} me={me} readOnly={s.id === "others"} authorName={names.get(t.author)} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
