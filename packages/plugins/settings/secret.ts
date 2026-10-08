// Machine secrets (milestone 7, Blueprint 31): `hl secret set NAME` writes NAME=value to the knowledge repo's
// gitignored .env; `hl secret status [NAME...]` says where each name is found. Neither ever shows the value: the
// output, the activity line and the "secret.saved" event carry the name only.
import type { Context, SecretSource, VerbDef } from "@helmlock/core";
import { fail, ok, SECRET_NAME, SecretError, secretSource, setMachineSecret } from "@helmlock/core";
import { z } from "zod";
import { readTelegramRow } from "../telegram/index.ts";

export const DEFAULT_TOKEN_ENV = "HL_TELEGRAM_TOKEN";

const verb = <I extends z.ZodType, O>(d: VerbDef<I, O>): VerbDef => d as unknown as VerbDef;

export interface SecretSetResult {
  name: string;
  file: string;
  added: boolean;
  gitignore_updated: boolean;
}

export interface SecretStatusRow {
  name: string;
  source: SecretSource | "missing";
  /** What uses it (e.g. "telegram.token_env", "providers.openrouter"), when known. */
  used_by?: string;
}

const rootOf = (ctx: Context) => ctx.get("workspace").root;

/** Names the workspace refers to: the Telegram token variable and every provider key_env. */
async function knownNames(ctx: Context): Promise<{ name: string; used_by: string }[]> {
  const out: { name: string; used_by: string }[] = [];
  try {
    const row = await readTelegramRow(ctx);
    if (row) {
      const t = row.config?.token_env;
      out.push({ name: typeof t === "string" && t ? t : DEFAULT_TOKEN_ENV, used_by: "telegram.token_env" });
    }
  } catch {
    /* settings unreadable: nothing to add */
  }
  if (ctx.has("providers"))
    try {
      for (const p of ctx.get("providers").providers()) if (p.key_env) out.push({ name: p.key_env, used_by: `providers.${p.id}` });
    } catch {
      /* providers config unreadable */
    }
  return out;
}

export const secretSetVerb = verb({
  id: "secret set",
  summary: "Save a secret (a bot token or an API key) in this machine's .env, which git ignores. The value is never shown or logged.",
  examples: ["hl secret set HL_TELEGRAM_TOKEN", "hl secret set OPENROUTER_API_KEY < key.txt"],
  args: ["name"],
  secret: ["value"],
  input: z.object({
    name: z.string().min(1).describe("variable name, such as HL_TELEGRAM_TOKEN"),
    value: z.string().describe("the secret (prompted hidden, or read from stdin; never on the command line)"),
  }),
  writes: true,
  async run(v, i) {
    const name = i.name.trim();
    if (!SECRET_NAME.test(name)) {
      // Someone pasted the secret into the name field: say so without repeating it.
      return fail("bad-secret-name", "the name must be a variable name such as HL_TELEGRAM_TOKEN (upper case, digits, _)", {
        fix: "put the variable name in name and the secret itself in value",
      });
    }
    let r: Awaited<ReturnType<typeof setMachineSecret>>;
    try {
      r = await setMachineSecret(rootOf(v.ctx), name, i.value, { dryRun: v.dryRun });
    } catch (e) {
      if (e instanceof SecretError) return fail(e.rule, e.message, e.fix ? { fix: e.fix } : {});
      // Never pass through a raw error (it could quote the file); name only.
      return fail("secret-write", `could not write ${name} to .env: ${(e as NodeJS.ErrnoException).code ?? "error"}`);
    }
    const data: SecretSetResult = { name, file: r.file, added: r.added, gitignore_updated: r.gitignoreUpdated };
    if (v.dryRun) return ok(data, `would save ${name} in this machine's .env (gitignored)`);
    await v.ctx.emit("secret.saved", { name, actor: v.actor });
    const shadow = process.env[name] ? ` Note: ${name} is also set in the environment, which wins over .env.` : "";
    return ok(data, `${name} saved in this machine's .env (gitignored)${r.gitignoreUpdated ? "; added .env to .gitignore" : ""}.${shadow}`);
  },
});

export const secretStatusVerb = verb({
  id: "secret status",
  summary: "Where each secret comes from on this machine (environment, .env or missing). Never shows values.",
  examples: ["hl secret status", "hl secret status HL_TELEGRAM_TOKEN OPENROUTER_API_KEY"],
  args: ["...names"],
  input: z.object({ names: z.array(z.string()).optional() }),
  writes: false,
  async run(v, i) {
    const root = rootOf(v.ctx);
    const known = await knownNames(v.ctx);
    const asked = (i.names ?? []).map((n) => n.trim()).filter(Boolean);
    const bad = asked.filter((n) => !SECRET_NAME.test(n));
    if (bad.length) return fail("bad-secret-name", `${bad.length} name(s) are not variable names`, { fix: "names look like HL_TELEGRAM_TOKEN" });
    const names = asked.length ? asked : [...new Set(known.map((k) => k.name))];
    const rows: SecretStatusRow[] = names.map((name) => {
      const used = known.filter((k) => k.name === name).map((k) => k.used_by);
      return { name, source: secretSource(root, process.env, name) ?? "missing", ...(used.length ? { used_by: used.join(", ") } : {}) };
    });
    const label = { environment: "environment", ".env": "this machine's .env", missing: "missing" } as const;
    const text = rows.length
      ? rows.map((r) => `${r.name}: ${label[r.source]}${r.used_by ? ` (${r.used_by})` : ""}`).join("\n")
      : "no secrets are referred to by this workspace";
    return ok(rows, text);
  },
});
