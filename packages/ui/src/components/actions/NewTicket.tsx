// One-line new ticket (F84): describe, pick size, priority and project, send. Opened by "New ticket" or the c key (F68).
import { Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { useBoard } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Kbd } from "@/components/ui/input";
import { isTyping } from "@/lib/keys";
import { ActionForm, Field, PRIORITIES, Select, SIZES } from "./fields";
import { useAction } from "./use-action";

// Tiny shared open state so any page's button and the global key open the same composer.
let open = false;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  for (const s of subs) s();
};
export const openNewTicket = () => setOpen(true);
const useOpen = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => open,
  );

/** The id of the created ticket from `ticket new` data ({ ticket: { ticket: { id } } }), tolerant of a flatter shape. */
export function createdId(data: unknown): string | undefined {
  const t = (data as { ticket?: { id?: string; ticket?: { id?: string }; card?: { id?: string } } } | null)?.ticket;
  return t?.ticket?.id ?? t?.card?.id ?? t?.id;
}

export function NewTicketButton({ className }: { className?: string }) {
  return (
    <Button size="sm" onClick={openNewTicket} className={className} title="New ticket (c)">
      <Plus />
      New ticket
    </Button>
  );
}

function Composer({ onClose }: { onClose: () => void }) {
  const action = useAction("ticket new");
  const navigate = useNavigate();
  const board = useBoard();
  const projects = [...new Set((board.data?.tickets ?? []).map((t) => t.project).filter((p): p is string => !!p))].sort();
  const [title, setTitle] = useState("");
  const [size, setSize] = useState("M");
  const [priority, setPriority] = useState("normal");
  const [project, setProject] = useState("");

  const input = () => ({
    title: title.trim(),
    size,
    priority,
    ...(project.trim() ? { project: project.trim() } : {}),
  });

  return (
    <ActionForm
      label="New ticket"
      action={action}
      input={input}
      submitLabel="Create"
      canSubmit={title.trim().length > 0}
      onDone={(r) => {
        const id = createdId(r.data);
        onClose();
        if (id) navigate(`/t/${encodeURIComponent(id)}`);
      }}
      className="mt-3"
    >
      <Input autoFocus aria-label="Title" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
      <div className="grid grid-cols-3 gap-2">
        <Field label="Size">
          <Select value={size} onChange={(e) => setSize(e.target.value)}>
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
        <Field label="Project (optional)">
          <Input list="hl-projects" value={project} onChange={(e) => setProject(e.target.value)} />
          <datalist id="hl-projects">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
      </div>
    </ActionForm>
  );
}

/** Mounted once in the shell: the dialog plus the c key. */
export function NewTicketHost() {
  const isOpen = useOpen();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openNewTicket();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      setOpen(false);
    };
  }, []);
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>New ticket</DialogTitle>
        <DialogDescription>
          Starts in the first stage. <Kbd>Enter</Kbd> creates and opens it.
        </DialogDescription>
        {isOpen && <Composer onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
