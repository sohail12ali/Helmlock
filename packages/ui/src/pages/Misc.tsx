// Todos, Work, Knowledge, Settings and Search. Simple read-only pages for milestone 2.
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "@/api/client";
import { keys, useSearch, useSkills, useWorkspace } from "@/api/hooks";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ThemePref, useTheme } from "@/lib/theme";

export function TodosPage() {
  return (
    <PageLayout id="todos">
      <PageHeader title="Todos" />
      <EmptyState
        title="Todos are not in the console yet."
        hint="List and add them from the CLI; this page will show them in a later milestone."
        command="hl todo list"
      />
    </PageLayout>
  );
}

function weekStart(d = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export function WorkPage() {
  const from = weekStart();
  const q = useQuery({ queryKey: keys.worklog({ from }), queryFn: ({ signal }) => api.worklog({ from }, signal) });
  const total = (q.data ?? []).reduce((n, w) => n + w.hours_alloc, 0);
  return (
    <PageLayout id="work">
      <PageHeader title="Work">
        <span className="text-xs text-muted-foreground">
          since <Mono>{from}</Mono> · <Mono>{total.toFixed(2)}h</Mono>
        </span>
      </PageHeader>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No work logged this week." command='hl log-work <T> "<one sentence>"' />
      ) : (
        <Card className="overflow-x-auto p-3">
          <table className="w-full text-sm" aria-label="Work log">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Author</th>
                <th className="py-1.5 pr-3 font-medium">Ticket</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium">Work</th>
                <th className="py-1.5 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr key={`${w.date}-${w.author}-${w.ticket}-${w.text}`} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    <Mono>{w.date}</Mono>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Mono>{w.author}</Mono>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Link className="font-mono text-primary hover:underline" to={`/t/${encodeURIComponent(w.ticket)}`}>
                      {w.ticket}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{w.category}</td>
                  <td className="py-1.5 pr-3">{w.text}</td>
                  <td className="py-1.5 text-right">
                    <Mono>{w.hours_alloc}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PageLayout>
  );
}

export function KnowledgePage() {
  const q = useSkills();
  return (
    <PageLayout id="knowledge">
      <PageHeader title="Knowledge" />
      <p className="mb-3 text-sm text-muted-foreground">
        The wiki and project graph arrive in a later milestone. Skills across the three layers are listed here.
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No skills found." command="hl skill list" />
      ) : (
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
      )}
    </PageLayout>
  );
}

export function SettingsPage() {
  const { pref, setPref } = useTheme();
  const ws = useWorkspace();
  const resetLayout = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("hl.layout.") || k.startsWith("hl.tickets.")) localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
    location.reload();
  };
  return (
    <PageLayout id="settings">
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="mb-1.5 text-muted-foreground">Theme (stored in this browser only)</legend>
              {(["system", "light", "dark"] as ThemePref[]).map((p) => (
                <Button key={p} size="sm" variant={pref === p ? "secondary" : "outline"} aria-pressed={pref === p} onClick={() => setPref(p)}>
                  {p === "system" ? "Follow system" : p === "light" ? "Light" : "Dark"}
                </Button>
              ))}
            </fieldset>
            <div>
              <Button size="sm" variant="outline" onClick={resetLayout}>
                Reset panel sizes
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {ws.isError ? (
              <ErrorState error={ws.error} />
            ) : ws.data ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{ws.data.name}</dd>
                <dt className="text-muted-foreground">Author</dt>
                <dd>{ws.data.author ? `${ws.data.author.name} (${ws.data.author.id})` : "not set"}</dd>
                <dt className="text-muted-foreground">Root</dt>
                <dd className="break-all font-mono text-xs">{ws.data.root}</dd>
                <dt className="text-muted-foreground">Delivery</dt>
                <dd className="break-all font-mono text-xs">{ws.data.delivery}</dd>
                <dt className="text-muted-foreground">Folders</dt>
                <dd className="flex flex-col gap-0.5">
                  {ws.data.folders.map((f) => (
                    <span key={f.path}>
                      <Mono>{f.name}</Mono> <Badge variant="outline">{f.layer}</Badge>
                    </span>
                  ))}
                </dd>
                <dt className="text-muted-foreground">Version</dt>
                <dd>
                  <Mono>
                    helmlock {ws.data.version.helmlock} · api v{ws.data.version.api}
                  </Mono>
                </dd>
              </dl>
            ) : (
              <Loading />
            )}
            <CopyCommand className="mt-3 max-w-md" label="Resolved paths" command="hl where" />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const term = params.get("q") ?? "";
  const q = useSearch(term);
  const ticketOf = (path: string) => /artifacts\/(T-[^/]+)\//.exec(path.replace(/\\/g, "/"))?.[1];
  return (
    <PageLayout id="search">
      <PageHeader title={term ? `Search: ${term}` : "Search"} />
      {term.trim().length < 2 ? (
        <EmptyState title="Type at least two characters in the search box." hint="Press / to jump to it." />
      ) : q.isPending ? (
        <Loading label="Searching" />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No matches." hint="Search covers tickets, records, notes and logs in this workspace." />
      ) : (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Search results">
          {q.data.map((h) => {
            const t = ticketOf(h.path);
            return (
              <li key={`${h.path}:${h.line}`} className="rounded-md border bg-card px-3 py-2">
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <Mono>
                    {h.path}:{h.line}
                  </Mono>
                  {t && (
                    <Link className="font-mono text-primary hover:underline" to={`/t/${encodeURIComponent(t)}`}>
                      {t}
                    </Link>
                  )}
                </div>
                <p className="truncate">{h.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </PageLayout>
  );
}

export function NotFoundPage() {
  return (
    <PageLayout id="404">
      <EmptyState title="This page does not exist." hint={<Link to="/">Go to the overview</Link>} />
    </PageLayout>
  );
}
