// One verb's command line: positional args from VerbDef.args, options from the input schema,
// `--some-flag` -> input key `some_flag`, repeatable flags -> arrays. Built only after the verb's plugin is loaded.
import type { FieldInfo, VerbDef } from "@helmlock/core";
import { Command, Option } from "commander";

export interface LeafSpec {
  cmd: Command;
  /** Positional names in order; a "...rest" name collects the remainder. */
  args: string[];
  fields: Map<string, FieldInfo>;
  /** commander attribute name -> input key. */
  attr: Map<string, string>;
}

const flagName = (key: string) => key.replace(/_/g, "-");

export function buildLeaf(def: Pick<VerbDef, "id" | "summary" | "examples" | "args" | "repeatable" | "secret">, all: FieldInfo[]): LeafSpec {
  // Secret inputs never come from the command line (shell history, process lists): main() prompts or reads stdin.
  const fields = all.filter((f) => !def.secret?.includes(f.key));
  const cmd = new Command(`hl ${def.id}`)
    .description(def.summary)
    .exitOverride()
    .helpOption(false)
    .helpCommand(false)
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .showSuggestionAfterError(true);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const args = [...(def.args ?? [])];
  const positional = new Set(args.map((a) => a.replace(/^\.\.\./, "")));
  for (const a of args) {
    const rest = a.startsWith("...");
    const key = a.replace(/^\.\.\./, "");
    const f = byKey.get(key);
    const label = `${flagName(key)}${rest ? "..." : ""}`;
    // Declared optional for commander; required ones are prompted for (TTY) or reported (piped).
    cmd.argument(`[${label}]`, f?.description ?? (f?.required ? "required" : "optional"));
  }
  const repeatable = new Set(def.repeatable ?? []);
  const attr = new Map<string, string>();
  for (const f of fields) {
    if (positional.has(f.key)) continue;
    const many = f.kind === "array" || repeatable.has(f.key);
    const choices = f.choices ? ` (${f.choices.join("|")})` : "";
    const desc = `${f.description ?? ""}${choices}${many ? " (repeatable)" : ""}${f.required ? " (required)" : ""}`.trim();
    const opt = f.kind === "boolean" ? new Option(`--${flagName(f.key)}`, desc) : new Option(`--${flagName(f.key)} <value>`, desc);
    if (many) opt.argParser((v: string, prev: unknown) => [...((prev as string[] | undefined) ?? []), v]);
    cmd.addOption(opt);
    attr.set(opt.attributeName(), f.key);
  }
  return { cmd, args, fields: byKey, attr };
}

const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v);

export interface ParsedLeaf {
  input: Record<string, unknown>;
  /** Required fields with no value. */
  missing: FieldInfo[];
}

/** Parse argv (after the verb words). Throws a CommanderError on unknown options or too many arguments. */
export function parseLeaf(spec: LeafSpec, argv: string[]): ParsedLeaf {
  spec.cmd.parse(argv, { from: "user" });
  const input: Record<string, unknown> = {};
  const opts = spec.cmd.opts() as Record<string, unknown>;
  // Commander reads a `--no-x` flag as the negation of x (default true): map it back to the field `no_x`.
  const negated = new Set(spec.cmd.options.filter((o) => o.negate).map((o) => o.attributeName()));
  for (const [a, v] of Object.entries(opts)) {
    const key = spec.attr.get(a) ?? a;
    if (negated.has(a)) {
      if (v === false) input[key] = true;
      continue;
    }
    input[key] = v;
  }
  const pos = spec.cmd.processedArgs as unknown[];
  spec.args.forEach((name, i) => {
    const key = name.replace(/^\.\.\./, "");
    if (name.startsWith("...")) {
      const v = pos[i];
      if (Array.isArray(v) && v.length) input[key] = v;
      return;
    }
    if (pos[i] !== undefined) input[key] = pos[i];
  });
  for (const [k, v] of Object.entries(input)) {
    const f = spec.fields.get(k);
    if (f?.kind === "number") input[k] = toNumber(v);
    if (f?.kind === "array") {
      const arr = Array.isArray(v) ? v : [v];
      input[k] = f.of === "number" ? arr.map(toNumber) : arr;
    }
  }
  const missing = [...spec.fields.values()].filter((f) => f.required && input[f.key] === undefined && f.kind !== "boolean");
  return { input, missing };
}
