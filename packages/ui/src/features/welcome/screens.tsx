// The /welcome screens that are a single question: You, Your code, Phone and First task (Blueprint 34).
import type { VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "@/api/client";
import { slugify } from "@/api/m6";
import { m8 } from "@/api/m8";
import { PROJECT_INVALIDATE } from "@/api/projects";
import { setupApi } from "@/api/setup";
import { callVerb } from "@/api/verbs";
import { Mono, TicketLink } from "@/components/common";
import { Field, Select, Textarea } from "@/components/forms/controls";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddProject } from "@/features/projects/AddProject";
import { TelegramSetup } from "@/features/setup/TelegramSetup";
import { clearDraft, titleFrom } from "./draft";
import { Footer, Screen, useWelcome } from "./WelcomePage";

const message = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.fix ? ` (${e.fix})` : ""}` : "The console server is not reachable.");
const REFRESH = ["setup", "people", "workspace", "overview"];

// ---------- 1. you ----------

export function YouScreen() {
  const { detect, draft, patch, next } = useWelcome();
  const qc = useQueryClient();
  const uid = useId();
  const you = detect.you;
  const form = draft.you ?? {
    name: you.git_name ?? "",
    email: you.git_email ?? "",
    id: you.suggested_slug ?? "",
    initials: you.suggested_initials ?? "",
  };
  const [problem, setProblem] = useState<string>();
  const set = (k: keyof typeof form, v: string) => patch({ you: { ...form, [k]: v } });
  const git = [you.git_name, you.git_email].filter((x): x is string => !!x);

  const save = async (body: { id: string; name?: string; initials?: string; email?: string }): Promise<boolean> => {
    setProblem(undefined);
    try {
      // The git spellings are claimed only now, after the person confirmed this is them.
      await setupApi.you({ ...body, git });
      for (const k of REFRESH) void qc.invalidateQueries({ queryKey: [k] });
      return true;
    } catch (e) {
      setProblem(message(e));
      return false;
    }
  };

  if (you.author_known)
    return (
      <Screen title="You are set" lead="This machine already knows who you are, so there is nothing to ask here." footer={<Footer />}>
        <p className="text-sm">
          Working as <span className="font-medium">{you.person?.name}</span> (<Mono>{you.person?.id}</Mono>).
        </p>
      </Screen>
    );

  const valid = /^[a-z0-9][a-z0-9-]*$/.test(form.id) && /^[a-z]{2,3}$/.test(form.initials) && form.name.trim().length > 0;
  return (
    <Screen
      title="Is this you?"
      lead={
        you.git_name
          ? "Filled in from this repo's git settings. Nothing is saved until you confirm; then you are added to the team roster and this machine works as you."
          : "Tell the team roster who you are; this machine then works as you."
      }
      footer={
        <Footer
          canContinue={valid}
          continueLabel="Yes, this is me"
          onContinue={() => save({ id: form.id, name: form.name.trim(), initials: form.initials, ...(form.email.trim() ? { email: form.email.trim() } : {}) })}
        />
      }
    >
      {you.match && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            The roster already has <span className="font-medium">{you.match.name}</span> (<Mono>{you.match.id}</Mono>) for this git name.
          </span>
          <Button
            size="sm"
            onClick={async () => {
              if (you.match && (await save({ id: you.match.id }))) next();
            }}
          >
            I am {you.match.name}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
        <Field label="Name" htmlFor={`${uid}-name`} required>
          <Input id={`${uid}-name`} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Email" htmlFor={`${uid}-email`}>
          <Input id={`${uid}-email`} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Id" htmlFor={`${uid}-id`} required hint="Lowercase, used in file names and author.local.">
          <Input id={`${uid}-id`} className="font-mono" value={form.id} onChange={(e) => set("id", e.target.value.toLowerCase())} />
        </Field>
        <Field label="Initials" htmlFor={`${uid}-initials`} required hint="Two or three letters; ticket ids use them (T-001-al).">
          <Input id={`${uid}-initials`} className="font-mono" value={form.initials} onChange={(e) => set("initials", e.target.value.toLowerCase())} />
        </Field>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </Screen>
  );
}

// ---------- 3. your code ----------

export function CodeScreen() {
  const { detect } = useWelcome();
  const qc = useQueryClient();
  const [ticked, setTicked] = useState<string[]>(() => detect.folders.map((f) => f.name));
  const [failed, setFailed] = useState<{ folder: string; result: VerbCallResult }[]>([]);
  const chosen = detect.folders.filter((f) => ticked.includes(f.name));

  const addTicked = async (): Promise<boolean> => {
    const out: { folder: string; result: VerbCallResult }[] = [];
    for (const f of chosen) {
      const result = await callVerb("project add", { folder: f.name, path: f.path, ...(slugify(f.name) ? { id: slugify(f.name) } : {}), yes: true });
      if (!result.ok) out.push({ folder: f.name, result });
    }
    setFailed(out);
    for (const k of PROJECT_INVALIDATE) void qc.invalidateQueries({ queryKey: [k] });
    return out.length === 0;
  };

  return (
    <Screen
      title="Where does your code live?"
      lead="Each repo folder becomes a project: agents work in it and its knowledge collects under projects/. You can add more any time."
      footer={
        <Footer
          continueLabel={chosen.length ? `Add ${chosen.length} project${chosen.length === 1 ? "" : "s"} and continue` : "Continue"}
          onContinue={chosen.length ? addTicked : undefined}
        />
      }
    >
      {detect.folders.length > 0 && (
        <fieldset className="flex flex-col gap-1.5" aria-label="Folders in the workspace file">
          <legend className="mb-1 text-sm font-semibold">Already in your workspace file</legend>
          {detect.folders.map((f) => (
            <label key={f.name} className="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
              <input
                type="checkbox"
                className="accent-primary"
                checked={ticked.includes(f.name)}
                onChange={(e) => setTicked((t) => (e.target.checked ? [...t, f.name] : t.filter((x) => x !== f.name)))}
              />
              <span className="font-medium">{f.name}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{f.path}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{detect.folders.length ? "Another folder" : "Add a folder"}</h2>
        <AddProject />
      </div>
      {failed.map((f) => (
        <div key={f.folder} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{f.folder}</p>
          <VerbResult result={f.result} />
        </div>
      ))}
    </Screen>
  );
}

// ---------- 5. phone ----------

export function PhoneScreen() {
  return (
    <Screen
      title="Reach your crew from your phone?"
      lead="A Telegram bot lets you ask, approve and hand off work when you are away from this machine. Optional."
      footer={<Footer />}
    >
      <TelegramSetup />
    </Screen>
  );
}

// ---------- 6. first task ----------

export function FirstTaskScreen() {
  const { detect, draft, patch } = useWelcome();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uid = useId();
  const task = draft.task ?? { text: "", project: detect.projects[0]?.id ?? "" };
  const [failed, setFailed] = useState<VerbCallResult>();
  const [handoff, setHandoff] = useState<{ ticket: string; problem: string }>();
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof task>) => patch({ task: { ...task, ...p } });

  const start = async () => {
    setBusy(true);
    setFailed(undefined);
    setHandoff(undefined);
    try {
      const text = task.text.trim();
      const r = await callVerb("ticket new", {
        title: titleFrom(text),
        ...(text !== titleFrom(text) ? { summary: text } : {}),
        ...(task.project ? { project: task.project } : {}),
      });
      if (!r.ok) return setFailed(r);
      const id = (r.data as { id?: string } | undefined)?.id;
      if (!id) return setFailed({ ok: false, code: 1, error: { rule: "bad-response", message: "ticket new did not return an id" } });
      for (const k of ["setup", "board", "tickets", "overview"]) void qc.invalidateQueries({ queryKey: [k] });
      try {
        // The next-step role takes it (no role given: the crew picks it from the stage).
        await m8.handoff(id, {});
      } catch (e) {
        clearDraft();
        return setHandoff({ ticket: id, problem: message(e) });
      }
      clearDraft();
      navigate(`/t/${encodeURIComponent(id)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="What should we work on first?"
      lead="One sentence is enough. It becomes a ticket, the crew's first role picks it up, and you watch it work."
      footer={
        <Footer
          canContinue={!!task.text.trim() && !handoff}
          continueLabel="Start"
          busy={busy}
          onContinue={async () => {
            await start();
            return false;
          }}
        />
      }
    >
      <Field label="The task" htmlFor={`${uid}-text`} required>
        <Textarea
          id={`${uid}-text`}
          rows={3}
          value={task.text}
          placeholder="Add a dark mode toggle to the settings page"
          onChange={(e) => set({ text: e.target.value })}
        />
      </Field>
      <Field label="Project" htmlFor={`${uid}-project`}>
        <Select id={`${uid}-project`} value={task.project} onChange={(e) => set({ project: e.target.value })}>
          <option value="">No project</option>
          {detect.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {failed && <VerbResult result={failed} />}
      {handoff && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
          <p>
            Created <TicketLink id={handoff.ticket} />, but no role could take it yet: {handoff.problem}
          </p>
          <div>
            <Button size="sm" onClick={() => navigate(`/t/${encodeURIComponent(handoff.ticket)}`)}>
              Open the ticket
            </Button>
          </div>
        </div>
      )}
    </Screen>
  );
}
