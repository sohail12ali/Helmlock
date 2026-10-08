// All actions: every console verb from GET /verbs with a generated form (F9c). The generic fallback for power users.
import { useSearchParams } from "react-router";
import { useVerbCatalog } from "@/api/write-hooks";
import { CopyCommand, EmptyState, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { VerbForm } from "@/components/forms/VerbForm";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Query roots a verb's noun touches; SSE covers the rest. */
function invalidateFor(id: string): string[] {
  const noun = id.split(" ")[0];
  if (noun === "todo") return ["todos", "overview"];
  if (noun === "log-work") return ["worklog", "overview"];
  if (noun === "config") return ["settings", "workspace", "verbs"];
  return ["board", "tickets", "ticket", "artifact", "overview"];
}

export function ActionsPage() {
  const q = useVerbCatalog();
  const [params, setParams] = useSearchParams();
  const selected = params.get("verb") ?? "";
  const verb = q.data?.find((v) => v.id === selected);
  const groups = new Map<string, NonNullable<typeof q.data>>();
  for (const v of q.data ?? []) {
    const noun = v.id.includes(" ") ? v.id.split(" ")[0]! : "other";
    groups.set(noun, [...(groups.get(noun) ?? []), v]);
  }
  return (
    <PageLayout id="actions">
      <PageHeader title="All actions" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No console actions are registered." command="hl verbs" />
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,16rem)_1fr]">
          <nav aria-label="Actions" className="flex flex-col gap-2 text-sm">
            {[...groups].map(([noun, verbs]) => (
              <div key={noun}>
                <p className="mb-0.5 text-xs text-muted-foreground">{noun}</p>
                <ul className="flex flex-wrap gap-1 md:flex-col md:gap-0">
                  {verbs.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        aria-current={v.id === selected || undefined}
                        onClick={() => setParams({ verb: v.id })}
                        className={cn(
                          "w-full rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent",
                          v.id === selected && "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {v.id}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {verb ? (
            <Card className="min-w-0">
              <CardHeader className="flex-col items-start">
                <CardTitle>
                  <Mono>{verb.id}</Mono>
                </CardTitle>
                <p className="text-sm text-ink2">{verb.summary}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <VerbForm key={verb.id} verb={verb} invalidate={invalidateFor(verb.id)} submitLabel="Run" />
                {verb.examples.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">Same from the CLI</p>
                    {verb.examples.map((e) => (
                      <CopyCommand key={e} command={e} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState title="Pick an action." hint="Each form is generated from the verb's inputs. Preview runs it as a dry run first." />
          )}
        </div>
      )}
    </PageLayout>
  );
}
