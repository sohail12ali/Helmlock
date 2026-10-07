import { fmtDateTime } from "@/lib/format";

type Line = { ok: true; obj: Record<string, unknown> } | { ok: false; raw: string };

function who(o: Record<string, unknown>): string {
  const actor = o.actor as { id?: string; kind?: string } | undefined;
  if (actor?.id) return actor.kind === "agent" ? `agent ${actor.id}` : actor.id;
  if (typeof o.author === "string") return o.author;
  return "";
}

function what(o: Record<string, unknown>): string {
  if (typeof o.text === "string") return o.text;
  const parts = [o.verb, o.entity].filter((x) => typeof x === "string");
  if (parts.length) return parts.join(" ") + (o.code === 2 ? " (blocked)" : o.code === 1 ? " (failed)" : "");
  const rest = Object.entries(o).filter(([k]) => k !== "ts");
  return rest.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("  ");
}

/** JSONL as a timeline (F148): one entry per line, newest last as written. */
export default function JsonlView({ text }: { text: string }) {
  const lines: Line[] = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((raw) => {
      try {
        const obj = JSON.parse(raw) as unknown;
        return obj && typeof obj === "object" && !Array.isArray(obj) ? { ok: true as const, obj: obj as Record<string, unknown> } : { ok: false as const, raw };
      } catch {
        return { ok: false as const, raw };
      }
    });
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No entries yet.</p>;
  return (
    <ol className="relative max-w-3xl border-l pl-4" data-testid="jsonl-view">
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only and have no id
        <li key={i} className="relative mb-3">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" />
          {l.ok ? (
            <>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{typeof l.obj.ts === "string" ? fmtDateTime(l.obj.ts) : `#${i + 1}`}</span>
                <span className="font-mono">{who(l.obj)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{what(l.obj)}</p>
            </>
          ) : (
            <pre className="font-mono text-xs text-destructive">{l.raw}</pre>
          )}
        </li>
      ))}
    </ol>
  );
}
