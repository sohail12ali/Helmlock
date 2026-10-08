// Knowledge (F115, F116, F125, F143, mockup 06): a read-only reader over the shared area, the projects and the closure
// digests. The real graph and backlinks live in Obsidian over the same files (F52); this page never writes.
import type { KnowledgeView } from "@helmlock/core/contracts";
import { BookOpen, FileText, FolderGit2, Search } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "@/api/client";
import { useSkills } from "@/api/hooks";
import { useKnowledge, useKnowledgeDoc } from "@/api/m5";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, PageHeader, TicketLink } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// The same sanitised Markdown pipeline as the artifact viewer (raw HTML never rendered), loaded on first open.
const MarkdownView = lazy(() => import("@/components/viewers/MarkdownView"));

type Tab = "index" | "projects" | "digests" | "skills";
const TABS: Tab[] = ["index", "projects", "digests", "skills"];
type IndexEntry = KnowledgeView["index"][number];

const OBSIDIAN_HINT = "Notes for Obsidian (graph, backlinks) are generated next to the files; open the knowledge repo as a vault to browse them.";

export function filterIndex(index: IndexEntry[], text: string, kind: string): IndexEntry[] {
  const t = text.trim().toLowerCase();
  return index.filter(
    (d) => (!kind || d.kind === kind) && (!t || d.title.toLowerCase().includes(t) || d.summary.toLowerCase().includes(t) || d.path.toLowerCase().includes(t)),
  );
}

function DocReader({ path }: { path: string }) {
  const q = useKnowledgeDoc(path);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <nav aria-label="Document path" className="flex flex-wrap items-center gap-1 pr-6 text-xs text-muted-foreground">
        {path.split("/").map((seg, i, all) => (
          <span key={all.slice(0, i + 1).join("/")} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            <span className={cn(i === all.length - 1 && "font-mono text-foreground")}>{seg}</span>
          </span>
        ))}
      </nav>
      {q.isPending ? (
        <Loading label="Opening document" />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <Suspense fallback={<Loading label="Opening document" />}>
          <MarkdownView text={q.data.text} />
        </Suspense>
      )}
    </div>
  );
}

function IndexTab({ index, open, selected }: { index: IndexEntry[]; open: (path: string) => void; selected?: string }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const kinds = useMemo(() => [...new Set(index.map((d) => d.kind))].sort(), [index]);
  const shown = useMemo(() => filterIndex(index, text, kind), [index, text, kind]);
  if (index.length === 0)
    return (
      <div className="flex flex-col gap-2">
        <EmptyState
          title="The shared index is empty."
          hint="Write wiki pages, runbooks and standards under shared/, then build the index. It is a generated file, one line per document."
          command="hl index build"
        />
        <EmptyState title="Looking for the graph?" hint={OBSIDIAN_HINT} command="hl notes build" />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Filter documents"
            placeholder="Filter by title, summary or path"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="pl-8"
          />
        </div>
        {kinds.length > 1 && (
          <fieldset className="flex flex-wrap gap-1.5" aria-label="Filter by kind">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(kind === k ? "" : k)}
                className={cn(
                  "inline-flex h-7 items-center rounded-full border px-2.5 text-xs",
                  kind === k ? "border-primary bg-accent text-primary" : "text-ink2 hover:bg-accent",
                )}
              >
                {k}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No document matches." hint="Try fewer words, or clear the kind filter." />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Shared documents">
          {shown.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => open(d.path)}
                aria-current={selected === d.path || undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-primary/50",
                  selected === d.path && "border-primary/60 ring-1 ring-primary/30",
                )}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{d.title}</span>
                    <Badge variant="outline">{d.kind}</Badge>
                  </span>
                  {d.summary && <span className="block text-ink2">{d.summary}</span>}
                  <Mono className="block truncate text-xs text-muted-foreground">{d.path}</Mono>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{OBSIDIAN_HINT}</p>
    </div>
  );
}

function ProjectsTab({ projects }: { projects: KnowledgeView["projects"] }) {
  if (projects.length === 0)
    return (
      <EmptyState
        title="No projects yet."
        hint="A project is the unit of knowledge: projects/<id>/ holds project.toml, a hub note, a wiki and the project graph. Add one from a product repo folder."
        command="hl project add <folder> --path <path> --id <id>"
      />
    );
  return (
    <ul className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Projects">
      {projects.map((p) => (
        <li key={p.id}>
          <Card className="flex h-full flex-col gap-2 p-3 text-sm" aria-label={`Project ${p.name}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <FolderGit2 className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />
              <span className="font-semibold">{p.name}</span>
              <Mono className="text-xs text-muted-foreground">{p.id}</Mono>
              <Badge variant={p.status === "active" ? "ok" : "default"} className="ml-auto">
                {p.status}
              </Badge>
            </div>
            {p.owners.length > 0 && (
              <p className="text-xs text-ink2">
                Owners: <Mono>{p.owners.join(", ")}</Mono>
              </p>
            )}
            {p.repos.length > 0 && (
              <p className="flex flex-wrap gap-1 text-xs">
                {p.repos.map((r) => (
                  <Badge key={r} variant="outline">
                    {r}
                  </Badge>
                ))}
              </p>
            )}
            {p.goals.length > 0 && (
              <ul className="list-disc pl-5 text-ink2">
                {p.goals.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            <Link
              to={`/tickets?project=${encodeURIComponent(p.id)}`}
              className="mt-auto pt-1 text-xs text-primary hover:underline"
              aria-label={`${p.tickets} tickets of ${p.name} on the board`}
            >
              {p.tickets} ticket{p.tickets === 1 ? "" : "s"} on the board
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DigestsTab({ digests, open, selected }: { digests: KnowledgeView["digests"]; open: (path: string) => void; selected?: string }) {
  const sorted = useMemo(() => [...digests].sort((a, b) => b.closed.localeCompare(a.closed)), [digests]);
  if (sorted.length === 0)
    return (
      <EmptyState
        title="No closure digests yet."
        hint="Closing a ticket writes a short digest of what was decided and built (F125). Close a verified ticket with the close skill."
      />
    );
  return (
    <ul className="flex flex-col gap-1" aria-label="Closure digests">
      {sorted.map((d) => (
        <li
          key={d.path}
          className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm", selected === d.path && "border-primary/60")}
        >
          <Mono className="text-xs text-muted-foreground">{d.closed.slice(0, 10)}</Mono>
          <TicketLink id={d.ticket} className="text-xs" />
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary hover:underline" onClick={() => open(d.path)}>
            {d.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SkillsTab() {
  const q = useSkills();
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.data.length === 0) return <EmptyState title="No skills found." command="hl skill list" />;
  return (
    <Card className="p-3">
      <ul className="divide-y text-sm" aria-label="Skills">
        {q.data.map((s) => (
          <li key={`${s.layer}-${s.name}`} className="flex flex-wrap items-baseline gap-2 py-2">
            <Mono className="font-medium">{s.name}</Mono>
            <Badge variant="outline">{s.layer}</Badge>
            <span className="w-full text-ink2">{s.description}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KnowledgePage() {
  const q = useKnowledge();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "index") as Tab;
  const doc = params.get("doc") ?? undefined;
  const set = (k: string, v: string | undefined) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  const unavailable = q.isError && q.error instanceof ApiError && q.error.status === 404;
  const data: KnowledgeView = q.data ?? { index: [], projects: [], digests: [] };

  return (
    <PageLayout id="knowledge" right={doc ? <DocReader path={doc} /> : undefined} rightTitle="Document" onCloseRight={() => set("doc", undefined)}>
      <PageHeader title="Knowledge">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="size-3.5" aria-hidden /> read-only; graph and backlinks in Obsidian
        </span>
      </PageHeader>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !unavailable ? (
        <ErrorState error={q.error} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => set("tab", v === "index" ? undefined : v)}>
          <TabsList aria-label="Knowledge sections">
            <TabsTrigger value="index">
              Index <Mono className="text-xs text-muted-foreground">{data.index.length}</Mono>
            </TabsTrigger>
            <TabsTrigger value="projects">
              Projects <Mono className="text-xs text-muted-foreground">{data.projects.length}</Mono>
            </TabsTrigger>
            <TabsTrigger value="digests">
              Digests <Mono className="text-xs text-muted-foreground">{data.digests.length}</Mono>
            </TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>
          {unavailable && (
            <p className="text-sm text-muted-foreground">
              This console server does not serve the knowledge area yet. Update Helmlock and restart <Mono>hl serve</Mono>.
            </p>
          )}
          <TabsContent value="index">
            <IndexTab index={data.index} open={(p) => set("doc", p)} selected={doc} />
          </TabsContent>
          <TabsContent value="projects">
            <ProjectsTab projects={data.projects} />
          </TabsContent>
          <TabsContent value="digests">
            <DigestsTab digests={data.digests} open={(p) => set("doc", p)} selected={doc} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsTab />
          </TabsContent>
        </Tabs>
      )}
      {!q.isPending && !q.isError && data.index.length > 0 && tab === "index" && !doc && (
        <CopyCommand className="mt-4 max-w-md" label="Rebuild the index" command="hl index build" />
      )}
    </PageLayout>
  );
}
