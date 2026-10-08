// Search and Not found. Simple read-only pages; Todos, Work and Settings have their own files.
import { Link, useSearchParams } from "react-router";
import { useSearch } from "@/api/hooks";
import { EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";

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
