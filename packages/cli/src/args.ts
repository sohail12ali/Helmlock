// Global flags, taken out of argv before the verb's own parse.

export interface Globals {
  json: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  /** Launch-flag config layer: {"plugin.<id>.<key>": value, disable: [ids]} (F103). */
  configFlags: Record<string, unknown>;
  /** argv with the globals removed, order kept. */
  rest: string[];
}

export function splitGlobals(argv: readonly string[]): Globals {
  const g: Globals = { json: false, dryRun: false, help: false, version: false, configFlags: {}, rest: [] };
  const disable: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      g.rest.push(...argv.slice(i));
      break;
    }
    const eq = a.indexOf("=");
    const name = a.startsWith("--") ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : undefined;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      i++;
      return next;
    };
    if (a === "--json") g.json = true;
    else if (a === "--dry-run") g.dryRun = true;
    else if (a === "--help" || a === "-h") g.help = true;
    else if (a === "--version" || a === "-V") g.version = true;
    else if (name?.startsWith("plugin.")) g.configFlags[name] = takeValue() ?? "true";
    else if (name === "disable") {
      const v = takeValue();
      if (v) disable.push(...v.split(",").filter(Boolean));
    } else g.rest.push(a);
  }
  if (disable.length) g.configFlags.disable = disable;
  return g;
}

/** Leading words (up to the first option), which name the verb. */
export function leadingWords(rest: readonly string[]): string[] {
  const out: string[] = [];
  for (const a of rest) {
    if (a.startsWith("-")) break;
    out.push(a);
  }
  return out;
}
