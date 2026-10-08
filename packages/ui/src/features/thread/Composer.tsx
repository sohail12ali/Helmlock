// Mockup 15 note 5: the composer talks to whoever is on the ticket. @role hands work to another role.
// Enter sends (Shift+Enter for a new line); the result says what happened: steered, queued, handed off or commented.
import type { CrewRole, SayResult } from "@helmlock/core/contracts";
import { Send } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { useTicketSay } from "@/api/m8";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/features/crew/bits";
import { cn } from "@/lib/utils";

type Role = Pick<CrewRole, "id" | "label">;

/** The "@query" being typed just before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

export function matchRoles(roles: Role[], query: string): Role[] {
  const q = query.toLowerCase();
  return roles.filter((r) => r.id.toLowerCase().startsWith(q) || r.label.toLowerCase().startsWith(q));
}

export function sayMessage(r: SayResult, roles?: Role[]): string {
  const who = r.run?.role ? roleLabel(r.run.role, roles).toLowerCase() : "agent";
  switch (r.action) {
    case "steered":
      return `Steered the ${who} mid-run.`;
    case "queued":
      return `Queued for the ${who}'s next turn.`;
    case "handed-off":
      return `Handed off to the ${who}${r.run ? ` (${r.run.id})` : ""}.`;
    case "commented":
      return "Added as a comment.";
  }
}

export function ThreadComposer({ ticket, onRole, roles }: { ticket: string; onRole?: string; roles: Role[] }) {
  const say = useTicketSay(ticket);
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const options = mention ? matchRoles(roles, mention.query) : [];
  const menuOpen = options.length > 0;
  const who = onRole ? roleLabel(onRole, roles).toLowerCase() : "crew";
  const other = roles.find((r) => r.id !== onRole)?.id ?? "role";

  const update = (value: string, caret: number) => {
    setText(value);
    setMention(mentionAt(value, caret));
    setActive(0);
  };

  const pick = (r: Role) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const value = `${text.slice(0, mention.start)}@${r.id} ${text.slice(end)}`;
    setText(value);
    setMention(null);
    const caret = mention.start + r.id.length + 2;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(caret, caret);
    });
  };

  const send = () => {
    const t = text.trim();
    if (!t || say.isPending) return;
    say.mutate(t, {
      onSuccess: (r) => {
        setText("");
        setMention(null);
        if (r) setToast(sayMessage(r, roles));
      },
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[active] ?? options[0]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="sticky bottom-0 z-10 -mx-1 bg-background px-1 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
      {toast && (
        <p role="status" className="mb-1.5 rounded-md border border-ok/40 bg-ok/5 px-2 py-1 text-xs text-ok" data-testid="say-toast">
          {toast}
        </p>
      )}
      {say.isError && (
        <p role="alert" className="mb-1.5 text-xs text-destructive">
          {say.error instanceof ApiError ? say.error.message : "Could not send."}
        </p>
      )}
      <form
        aria-label="Message the ticket"
        className="relative flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {menuOpen && (
          <div
            id={listId}
            role="listbox"
            aria-label="Roles"
            className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-lg border bg-popover p-1 text-sm shadow-lg"
          >
            {options.map((r, i) => (
              <div
                key={r.id}
                id={`${listId}-${r.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1", i === active && "bg-accent")}
              >
                <span className="font-mono text-primary">@{r.id}</span>
                <span className="text-muted-foreground">{r.label}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={box}
          aria-label="Message"
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={menuOpen && options[active] ? `${listId}-${options[active]!.id}` : undefined}
          rows={1}
          value={text}
          placeholder={`Message the ${who}, or @${other} ...`}
          onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKey}
          onBlur={() => setMention(null)}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-card px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim() || say.isPending}>
          <Send />
        </Button>
      </form>
    </div>
  );
}
