import { parseTomlForDisplay } from "./toml";

/** TOML as a table (F148): one block per [table] or [[array]] entry. */
export default function TomlView({ text }: { text: string }) {
  const sections = parseTomlForDisplay(text);
  if (sections.length === 0) return <p className="text-sm text-muted-foreground">This file is empty.</p>;
  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="toml-view">
      {sections.map((s) => (
        <section key={`${s.name}-${s.index ?? ""}`}>
          {s.name && (
            <h3 className="mb-1 font-mono text-xs text-muted-foreground">{s.index !== undefined ? `[[${s.name}]] #${s.index + 1}` : `[${s.name}]`}</h3>
          )}
          <table className="w-full overflow-hidden rounded-md border text-sm">
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <th scope="row" className="w-44 bg-sunk/60 px-2.5 py-1.5 text-left align-top font-mono text-xs font-normal text-ink2">
                    {r.key}
                  </th>
                  <td className="px-2.5 py-1.5 break-words whitespace-pre-wrap">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
