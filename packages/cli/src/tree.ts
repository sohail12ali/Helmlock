// The command tree, built from plugin.toml `verbs` and the core verbs without importing plugin code.
import { Command } from "commander";

export interface VerbEntry {
  id: string;
  /** "core" or the plugin that registers it. */
  owner: string;
}

const CORE_SUMMARY: Record<string, string> = {
  where: "show the resolved workspace, delivery repo, folders and author",
  doctor: "check the setup (--repair for safe fixes)",
  "help agent": "print the contract agents follow",
  "config show": "show composed plugin rows and their layer",
};

export function buildTree(entries: readonly VerbEntry[]): Command {
  const program = new Command("hl")
    .description("Helmlock: tickets, records and work logs as plain files. Grammar: hl <noun> <verb>.")
    .usage("<noun> <verb> [args] [--json] [--dry-run]")
    .option("--json", "print {ok,data} or {ok:false,code,error}")
    .option("--dry-run", "preview a write without changing files")
    .option("--plugin.<id>.<key>=<value>", "override one plugin setting for this call")
    .option("--disable <id>", "turn a plugin off for this call")
    .helpCommand(false)
    .helpOption("-h, --help", "help for hl or for one verb (with examples)");
  const nouns = new Map<string, Command>();
  const seen = new Set<string>();
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    // Several plugins may list one verb (e.g. runtime adapters list "run" so they mount with it).
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const [first, second] = e.id.split(" ") as [string, string | undefined];
    const desc = CORE_SUMMARY[e.id] ?? (e.owner === "core" ? "" : `(${e.owner})`);
    if (!second) {
      program.command(first).description(desc).allowUnknownOption().allowExcessArguments();
      continue;
    }
    let noun = nouns.get(first) ?? program.commands.find((c) => c.name() === first);
    if (!noun) {
      noun = program.command(first).description("").helpCommand(false);
      nouns.set(first, noun);
    }
    noun.command(second).description(desc).allowUnknownOption().allowExcessArguments();
  }
  for (const [name, noun] of nouns) noun.description(noun.commands.map((c) => c.name()).join(", ") || name);
  return program;
}

export interface Resolved {
  /** Full verb id when the words name a verb. */
  id?: string;
  /** Number of words used by the id. */
  used: number;
  /** The noun group when the words stop at a noun ("hl ticket"). */
  group?: Command;
}

/** Longest match first: two words, then one. */
export function resolve(program: Command, ids: ReadonlySet<string>, words: readonly string[]): Resolved {
  for (let n = Math.min(2, words.length); n > 0; n--) {
    const cand = words.slice(0, n).join(" ");
    if (ids.has(cand)) return { id: cand, used: n };
  }
  const group = words[0] ? program.commands.find((c) => c.name() === words[0] && c.commands.length) : undefined;
  if (group && words.length === 1) return { used: 1, group };
  return { used: 0 };
}
