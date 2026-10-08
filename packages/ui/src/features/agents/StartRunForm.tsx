// One-line new task (F84): describe it, pick agent, ticket, runtime, mode and model, send. A person starts runs (F97).
import type { RunStart } from "@helmlock/core/contracts";
import { Play } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "@/api/client";
import { useBoard } from "@/api/hooks";
import { useStartRun } from "@/api/m4";
import { useProjects } from "@/api/projects";
import { Mono } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveProject } from "@/features/projects/active";
import { AGENT_ROLES } from "./run-flags";

const MODES: { id: NonNullable<RunStart["mode"]>; label: string; hint: string }[] = [
  { id: "plan", label: "plan", hint: "read and plan only, no edits" },
  { id: "ask", label: "ask", hint: "asks you before each tool that writes" },
  { id: "auto-review", label: "auto-review", hint: "edits allowed, risky tools ask you" },
];

export function StartRunForm({ defaultTicket }: { defaultTicket?: string }) {
  const uid = useId();
  const navigate = useNavigate();
  const board = useBoard();
  const start = useStartRun();
  const [task, setTask] = useState("");
  const [agent, setAgent] = useState<string>("analyst");
  const [ticket, setTicket] = useState(defaultTicket ?? "");
  const [runtime, setRuntime] = useState<"claude-code" | "cursor">("claude-code");
  const [mode, setMode] = useState<NonNullable<RunStart["mode"]>>("plan");
  const [model, setModel] = useState("");
  // Milestone 7: the active project is the default; the run starts in its repo folder (the server resolves it).
  const { project: active } = useActiveProject();
  const projects = useProjects();
  const [project, setProject] = useState(active);
  useEffect(() => setProject(active), [active]);

  const submit = () => {
    const t = task.trim();
    if (!t || start.isPending) return;
    const body: RunStart = { task: t, runtime, mode };
    if (project) body.project = project;
    if (agent) body.agent = agent;
    if (ticket.trim()) body.ticket = ticket.trim();
    if (model.trim()) body.model = model.trim();
    start.mutate(body, {
      onSuccess: (r) => {
        setTask("");
        if (r?.id) navigate(`/agents/runs/${encodeURIComponent(r.id)}`);
      },
    });
  };

  const label = "sr-only";
  return (
    <form
      aria-label="Start a run"
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${uid}-task`} className={label}>
          Task
        </label>
        <Input
          id={`${uid}-task`}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task, e.g. draft the spec for T-014"
          className="min-w-[14rem] flex-[3_1_18rem]"
        />
        <label htmlFor={`${uid}-agent`} className={label}>
          Agent
        </label>
        <Select id={`${uid}-agent`} value={agent} onChange={(e) => setAgent(e.target.value)} className="w-auto flex-[0_1_8rem]">
          {AGENT_ROLES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="">no agent</option>
        </Select>
        <label htmlFor={`${uid}-ticket`} className={label}>
          Ticket
        </label>
        <Input
          id={`${uid}-ticket`}
          list={`${uid}-tickets`}
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          placeholder="Ticket"
          className="w-auto flex-[0_1_8rem] font-mono"
        />
        <datalist id={`${uid}-tickets`}>
          {(board.data?.tickets ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </datalist>
        {(projects.data?.projects.length ?? 0) > 0 && (
          <>
            <label htmlFor={`${uid}-project`} className={label}>
              Project
            </label>
            <Select
              id={`${uid}-project`}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-auto flex-[0_1_9rem]"
              title="Where the run starts: the project's repo folder, or the knowledge repo"
            >
              <option value="">knowledge repo</option>
              {projects.data?.projects.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.repos.some((r) => r.exists)}>
                  {p.name}
                </option>
              ))}
              {project && !projects.data?.projects.some((p) => p.id === project) && <option value={project}>{project}</option>}
            </Select>
          </>
        )}
        <label htmlFor={`${uid}-runtime`} className={label}>
          Runtime
        </label>
        <Select id={`${uid}-runtime`} value={runtime} onChange={(e) => setRuntime(e.target.value as typeof runtime)} className="w-auto flex-[0_1_8rem]">
          <option value="claude-code">claude-code</option>
          <option value="cursor">cursor</option>
        </Select>
        <label htmlFor={`${uid}-mode`} className={label}>
          Mode
        </label>
        <Select
          id={`${uid}-mode`}
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="w-auto flex-[0_1_8rem]"
          title={MODES.find((m) => m.id === mode)?.hint}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.hint}>
              {m.label}
            </option>
          ))}
        </Select>
        <label htmlFor={`${uid}-model`} className={label}>
          Model (optional)
        </label>
        <Input id={`${uid}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (optional)" className="w-auto flex-[0_1_9rem]" />
        <Button type="submit" disabled={!task.trim() || start.isPending}>
          <Play />
          {start.isPending ? "Starting" : "Start run"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}. Force mode stays in the terminal.</p>
      {start.isError && (
        <p role="alert" className="text-sm text-destructive">
          {start.error instanceof ApiError ? start.error.message : "Could not start the run."}
          {start.error instanceof ApiError && <Mono className="ml-2 text-xs">{start.error.rule}</Mono>}
          {start.error instanceof ApiError && start.error.fix && <span className="block text-xs text-muted-foreground">{start.error.fix}</span>}
        </p>
      )}
    </form>
  );
}
