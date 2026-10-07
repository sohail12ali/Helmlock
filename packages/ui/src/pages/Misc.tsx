// Knowledge, Search and Not found. Simple read-only pages; Todos, Work and Settings have their own files.
import { Link, useSearchParams } from "react-router";
import { useSearch, useSkills } from "@/api/hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

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
