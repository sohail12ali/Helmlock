#!/usr/bin/env node
// WALKING SKELETON (wave 0). S1 replaces this with commander + @clack/prompts, --help with examples,
// did-you-mean, TTY detection and tables. Convention kept by S1: `--some-flag` maps to input key `some_flag`.
import { createRuntime } from "@helmlock/core";
import { catalog } from "@helmlock/plugins";

async function main(argv: string[]): Promise<number> {
  const flags: Record<string, unknown> = {};
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      const key = k.replace(/-/g, "_");
      const next = argv[i + 1];
      let value: unknown = v ?? true;
      if (v === undefined && next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      }
      const prev = flags[key];
      flags[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else words.push(a);
  }
  const json = flags.json === true;
  const dryRun = flags.dry_run === true;
  delete flags.json;
  delete flags.dry_run;

  const rt = await createRuntime({ cwd: process.cwd(), catalog });
  try {
    const known = new Set<string>([
      ...rt.ctx
        .get("verbs")
        .list()
        .map((d) => d.id),
      ...[...rt.manifests.values()].flatMap((m) => m.verbs),
    ]);
    let id = "";
    let used = 0;
    for (let n = Math.min(words.length, 3); n > 0; n--) {
      const cand = words.slice(0, n).join(" ");
      if (known.has(cand)) {
        id = cand;
        used = n;
        break;
      }
    }
    if (!id) {
      process.stderr.write(`unknown command: ${words.join(" ") || "(none)"}\nknown: ${[...known].sort().join(", ")}\n`);
      return 1;
    }
    await rt.mountForVerb(id);
    const def = rt.ctx.get("verbs").get(id);
    const input: Record<string, unknown> = { ...flags };
    const rest = words.slice(used);
    (def?.args ?? []).forEach((name, i) => {
      if (name.startsWith("...")) input[name.slice(3)] = rest.slice(i);
      else if (rest[i] !== undefined) input[name] = rest[i];
    });
    const res = await rt.run(id, input, { json, dryRun, interactive: Boolean(process.stdout.isTTY) });
    if (res.ok) {
      process.stdout.write(json || res.text === undefined ? `${JSON.stringify(res.data, null, 2)}\n` : `${res.text}\n`);
      return 0;
    }
    const e = res.error;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, code: res.code, error: e }, null, 2)}\n`);
    else process.stderr.write(`error [${e.rule}] ${e.message}${e.file ? `\n  file: ${e.file}` : ""}${e.fix ? `\n  fix: ${e.fix}` : ""}\n`);
    return res.code;
  } finally {
    await rt.dispose();
  }
}

process.exitCode = await main(process.argv.slice(2));
