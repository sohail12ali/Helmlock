// hl: noun-then-verb CLI over the core verb registry (F55, F56, Blueprint 10).
// Command layout after Paperclip cli/src/index.ts (MIT, Copyright (c) 2025 Paperclip AI): one commander tree,
// global --json, examples in every --help. Plugin code is imported only when its verb runs.
import type { PluginCatalog } from "@helmlock/core";
import { CommanderError } from "commander";
// Values come from core's own modules, not the package index: the index re-exports the zod schemas, and zod
// alone costs about 110 ms of start time. (Contract request: a light "./cli" export in core's package.json.)
import { readManifests } from "../../core/src/runtime/manifests.ts";
import { CORE_VERBS } from "../../core/src/verbs/core-verbs.ts";
import { describeInput } from "../../core/src/verbs/input.ts";
import { didYouMean } from "../../core/src/verbs/suggest.ts";
import { leadingWords, splitGlobals } from "./args.ts";
import { buildLeaf, parseLeaf } from "./leaf.ts";
import { type Out, printFailure, printResult } from "./output.ts";
import { askMissing, askSecret, clackAsk } from "./prompt.ts";
import { buildTree, resolve, type VerbEntry } from "./tree.ts";

export interface MainIo {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  catalog: PluginCatalog;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** stdin and stdout are both a terminal. */
  tty: boolean;
  /** All of stdin as text (for secrets piped in when not a terminal). */
  readStdin?: () => Promise<string>;
  version?: string;
}

export async function main(io: MainIo): Promise<number> {
  const g = splitGlobals(io.argv);
  const color = io.tty && !io.env.NO_COLOR && !g.json;
  const out: Out = { stdout: io.stdout, stderr: io.stderr, color };
  const interactive = io.tty && !g.json;

  if (g.version) {
    io.stdout(`${io.version ?? "0.0.0"}\n`);
    return 0;
  }

  const manifests = readManifests(io.catalog, (l) => io.stderr(`hl: ${l}\n`));
  const entries: VerbEntry[] = [...CORE_VERBS, "serve"].map((id) => ({ id, owner: "core" }));
  for (const [pid, m] of manifests) for (const v of m.verbs) entries.push({ id: v, owner: pid });
  const ids = new Set(entries.map((e) => e.id));
  const program = buildTree(entries);

  let words = leadingWords(g.rest);
  // `hl help <verb...>` is `hl <verb...> --help` (except the `help agent` verb).
  if (words[0] === "help" && words[1] !== "agent") {
    g.help = true;
    g.rest = g.rest.slice(1);
    words = words.slice(1);
  }
  if (!words.length) {
    const text = program.helpInformation();
    if (g.rest.length && !g.help) {
      return printFailure({ rule: "unknown-command", message: `expected a verb before ${g.rest[0]}`, fix: "run `hl --help`" }, 1, g.json, out);
    }
    io.stdout(`${text}\nExit codes: 0 ok, 1 error, 2 blocked by a gate. Agents: run \`hl help agent\`.\n`);
    return 0;
  }

  // `hl serve` is a long-running command, not a registry verb (milestone 2 console).
  if (words[0] === "serve") {
    const { serve, SERVE_HELP } = await import("./serve.ts");
    if (g.help) {
      io.stdout(SERVE_HELP);
      return 0;
    }
    return serve(io, g.rest, g.json, out);
  }

  const r = resolve(program, ids, words);
  if (!r.id) {
    if (r.group) {
      const text = `${r.group.helpInformation().replace(/^Usage: .*$/m, `Usage: hl ${r.group.name()} <verb> [args]`)}`;
      if (g.help) {
        io.stdout(text);
        return 0;
      }
      io.stderr(text);
      return printFailure(
        { rule: "unknown-command", message: `hl ${r.group.name()} needs a verb`, fix: `one of: ${r.group.commands.map((c) => c.name()).join(", ")}` },
        1,
        g.json,
        out,
      );
    }
    const asked = words.slice(0, 2).join(" ");
    const near = [...new Set([...didYouMean(asked, ids), ...didYouMean(words[0] as string, ids)])].slice(0, 3);
    return printFailure(
      {
        rule: "unknown-command",
        message: `unknown command: ${asked}${near.length ? `. Did you mean: ${near.map((n) => `hl ${n}`).join(", ")}?` : ""}`,
        fix: "run `hl --help` for the list",
      },
      1,
      g.json,
      out,
    );
  }

  const id = r.id;
  const argv = g.rest.slice(r.used);
  const { createRuntime } = await import("../../core/src/runtime/runtime.ts");
  const rt = await createRuntime({ cwd: io.cwd, env: io.env, catalog: io.catalog, flags: g.configFlags, interactive, ask: clackAsk });
  try {
    await rt.mountForVerb(id);
    const def = rt.ctx.get("verbs").get(id);
    if (!def) {
      // Pending or failed plugin, or a config error: run() reports it with the loud line.
      return printResult(await rt.run(id, {}, { json: g.json }), g.json, out);
    }
    const spec = buildLeaf(def, describeInput(def.input));
    if (g.help) {
      io.stdout(spec.cmd.helpInformation() + helpAfter(def.examples));
      return 0;
    }
    const secrets = def.secret ?? [];
    const onArgv = secrets.filter((k) => argv.some((a) => a === `--${k.replace(/_/g, "-")}` || a.startsWith(`--${k.replace(/_/g, "-")}=`)));
    if (onArgv.length)
      return printFailure(
        {
          rule: "secret-on-argv",
          message: `hl ${id}: --${onArgv[0]?.replace(/_/g, "-")} is not accepted on the command line (it would stay in your shell history)`,
          fix: `run \`hl ${id}\` and paste it at the hidden prompt, or pipe it in: \`hl ${id} ... < file\``,
        },
        1,
        g.json,
        out,
      );
    let parsed: ReturnType<typeof parseLeaf>;
    try {
      parsed = parseLeaf(spec, argv);
    } catch (e) {
      if (e instanceof CommanderError) {
        const msg = e.message.replace(/^error: /, "");
        return printFailure({ rule: "bad-args", message: `hl ${id}: ${msg}`, fix: `see \`hl ${id} --help\`` }, 1, g.json, out);
      }
      throw e;
    }
    if (parsed.missing.length) {
      if (!interactive) {
        const names = parsed.missing.map((f) => (spec.args.some((a) => a.replace(/^\.\.\./, "") === f.key) ? `<${f.key}>` : `--${f.key.replace(/_/g, "-")}`));
        return printFailure({ rule: "missing-argument", message: `hl ${id}: missing ${names.join(", ")}`, fix: `see \`hl ${id} --help\`` }, 1, g.json, out);
      }
      const answers = await askMissing(id, parsed.missing);
      if (!answers) return printFailure({ rule: "cancelled", message: "cancelled" }, 1, g.json, out);
      Object.assign(parsed.input, answers);
    }
    for (const key of secrets) {
      let value = "";
      if (interactive) {
        const asked = await askSecret(id, key);
        if (asked === undefined) return printFailure({ rule: "cancelled", message: "cancelled" }, 1, g.json, out);
        value = asked;
      } else if (io.readStdin) value = (await io.readStdin()).replace(/\r?\n$/, "");
      if (!value.trim())
        return printFailure(
          { rule: "missing-argument", message: `hl ${id}: no ${key} given`, fix: `pipe it in on stdin (\`hl ${id} ... < file\`) or run it in a terminal` },
          1,
          g.json,
          out,
        );
      parsed.input[key] = value;
    }
    const res = await rt.run(id, parsed.input, { json: g.json, dryRun: g.dryRun, interactive });
    return printResult(res, g.json, out);
  } finally {
    await rt.dispose();
  }
}

function helpAfter(examples: readonly string[]): string {
  // Commander's addHelpText output is not part of helpInformation(); append it here.
  return `\nExamples:\n${examples.map((e) => `  ${e}`).join("\n")}\n\nGlobal: --json, --dry-run (writes), --help. Exit codes: 0 ok, 1 error, 2 blocked.\n`;
}
