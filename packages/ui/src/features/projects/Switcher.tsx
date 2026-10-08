// Where am I (milestone 7, Paperclip-style): the top bar names the knowledge center (its menu lists the other centers
// on this machine and how to open each: one console serves one center, F138) and shows the active project as a chip;
// the sidebar lists the projects. Selecting one filters the board, tickets, todos and runs.
import { Check, ChevronsUpDown, ExternalLink, FolderGit2, Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { useWorkspace } from "@/api/hooks";
import { useCenters, useProjects } from "@/api/projects";
import { CopyCommand, Mono } from "@/components/common";
import { cn } from "@/lib/utils";
import { openAddProject } from "./AddProject";
import { useActiveProject } from "./active";

// ---------- knowledge center (top bar) ----------

export function CenterSwitcher({ compact }: { compact?: boolean }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const centers = useCenters(open);
  const name = centers.data?.current.name ?? ws.data?.name ?? "Knowledge center";
  const root = ws.data?.root;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 min-w-[3.25rem] items-center gap-1 rounded-md px-1.5 text-sm font-semibold hover:bg-accent"
          title={root ? `Knowledge center: ${root}` : undefined}
          aria-label={`Knowledge center: ${name}. Other knowledge centers`}
        >
          <span className={cn("truncate", compact ? "max-w-[7rem]" : "max-w-[14rem]")}>{name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[min(24rem,calc(100vw-1rem))] rounded-lg border bg-popover p-3 text-sm shadow-lg animate-pop-in"
          aria-label="Knowledge centers"
        >
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">This console</p>
          <div className="mt-1 flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{name}</p>
              {root && (
                <p className="truncate font-mono text-xs text-muted-foreground" title={root}>
                  {root}
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Other knowledge centers on this machine</p>
          {centers.isPending ? (
            <p className="mt-1 text-xs text-muted-foreground">Looking...</p>
          ) : !centers.data ? (
            <p className="mt-1 text-xs text-muted-foreground">This console server does not list other centers yet.</p>
          ) : centers.data.others.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">None yet. Each knowledge center appears here after its first hl serve.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-2" aria-label="Other knowledge centers">
              {centers.data.others.map((c) => (
                <li key={c.root} className="rounded-md border px-2.5 py-2">
                  <p className="flex items-center gap-2 font-medium">
                    <span className={cn("size-2 shrink-0 rounded-full", c.running ? "bg-ok" : "bg-muted-foreground")} aria-hidden />
                    <span className="truncate">{c.name}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={c.root}>
                    {c.root}
                  </p>
                  {c.running && c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      running at {c.url.replace(/\/$/, "")}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <div className="mt-1 flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Not running. In that folder, run:</span>
                      <CopyCommand command={c.command} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">One console serves one knowledge center: each opens in its own tab.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------- active project chip (top bar) ----------

export function ProjectChip({ className }: { className?: string }) {
  const { project, setProject } = useActiveProject();
  const projects = useProjects();
  if (!project) {
    return (
      <span className={cn("hidden items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground md:inline-flex", className)}>
        <FolderGit2 className="size-3.5" aria-hidden />
        All projects
      </span>
    );
  }
  const p = projects.data?.projects.find((x) => x.id === project);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-full border border-primary/40 bg-accent py-0.5 pr-0.5 pl-2 text-xs text-primary",
        className,
      )}
      title={p ? `Active project: ${p.name} (${p.id})` : `Active project: ${project}`}
      data-testid="project-chip"
    >
      <FolderGit2 className="size-3.5 shrink-0" aria-hidden />
      <span className="max-w-[5rem] truncate font-medium sm:max-w-[9rem]">{p?.name ?? project}</span>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-full hover:bg-card"
        aria-label="Show all projects"
        onClick={() => setProject("")}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

// ---------- projects (sidebar) ----------

export function ProjectsNav({ collapsed, onPick }: { collapsed?: boolean; onPick?: () => void }) {
  const { project, setProject } = useActiveProject();
  const q = useProjects();
  if (collapsed || q.data === null) return null;
  const list = q.data?.projects ?? [];
  const item = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink2 hover:bg-accent hover:text-foreground";
  const pick = (id: string) => {
    setProject(id);
    onPick?.();
  };
  return (
    <section aria-labelledby="hl-projects-heading" className="mt-3 flex flex-col gap-0.5 border-t pt-2">
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 id="hl-projects-heading" className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Projects
        </h2>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"
          aria-label="Add project"
          title="Add project"
          onClick={() => {
            onPick?.();
            openAddProject();
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <button type="button" className={cn(item, !project && "bg-card font-medium text-foreground shadow-xs")} aria-pressed={!project} onClick={() => pick("")}>
        <FolderGit2 className="size-4 shrink-0" />
        <span className="truncate">All projects</span>
      </button>
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cn(item, project === p.id && "bg-card font-medium text-foreground shadow-xs")}
          aria-pressed={project === p.id}
          title={`${p.name} (${p.id})${p.repos.length ? `: ${p.repos.map((r) => r.folder).join(", ")}` : ""}`}
          onClick={() => pick(p.id)}
        >
          <span className="size-4 shrink-0 text-center font-mono text-[11px] leading-4 text-muted-foreground uppercase" aria-hidden>
            {p.name.charAt(0)}
          </span>
          <span className="truncate">{p.name}</span>
          {p.tickets > 0 && <Mono className="ml-auto text-[11px] text-muted-foreground">{p.tickets}</Mono>}
        </button>
      ))}
      {q.isSuccess && list.length === 0 && (
        <button type="button" className={cn(item, "text-primary")} onClick={openAddProject}>
          <Plus className="size-4 shrink-0" />
          Add your first project
        </button>
      )}
    </section>
  );
}
