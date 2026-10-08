// Machine secrets (Blueprint 31: credentials come from this machine). A secret is read by NAME from the process
// environment, else from the knowledge repo's gitignored `.env`. The file is read fresh on every call, so a token
// saved after the console started works without a restart. Values are never logged or returned by the helpers that
// describe a secret (secretSource): only the name and where it was found.
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceFile, withLock } from "./atomic.ts";

export const MACHINE_ENV_FILE = ".env";
/** An environment variable name as helmlock writes it: upper case, digits and underscores. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

export type SecretSource = "environment" | ".env";
type Env = Record<string, string | undefined>;

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(raw: string): string {
  const q = raw[0];
  if ((q === '"' || q === "'") && raw.length >= 2) {
    let end = 1;
    while (end < raw.length && raw[end] !== q) end += q === '"' && raw[end] === "\\" ? 2 : 1;
    if (end < raw.length) {
      const inner = raw.slice(1, end);
      return q === '"' ? inner.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c)) : inner;
    }
  }
  // Unquoted: an inline comment starts at " #".
  const hash = raw.search(/\s#/);
  return (hash >= 0 ? raw.slice(0, hash) : raw).trim();
}

/** Parse .env text: KEY=VALUE lines, optional quotes, `#` comments, blank lines, CRLF. Later lines win. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = LINE.exec(line);
    if (m) out[m[1] as string] = unquote(m[2] ?? "");
  }
  return out;
}

/** `<root>/.env` as a map (empty when missing or unreadable). Read fresh every call. */
export function readMachineEnv(root: string): Record<string, string> {
  const p = join(root, MACHINE_ENV_FILE);
  if (!existsSync(p)) return {};
  try {
    return parseEnvText(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** The process env with `.env` filling names that are unset or empty there (the process env wins). */
export function effectiveEnv(root: string, env: Env = process.env): Env {
  const file = readMachineEnv(root);
  const out: Env = { ...env };
  for (const [k, v] of Object.entries(file)) if (!out[k] && v) out[k] = v;
  return out;
}

/** One secret by name (process env first, then .env); undefined when neither has a non-empty value. */
export function machineSecret(root: string, name: string, env: Env = process.env): string | undefined {
  return env[name] || readMachineEnv(root)[name] || undefined;
}

/** Where a secret comes from, never its value. */
export function secretSource(root: string, env: Env, name: string): SecretSource | undefined {
  if (env[name]) return "environment";
  if (readMachineEnv(root)[name]) return ".env";
  return undefined;
}

export class SecretError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  constructor(rule: string, message: string, fix?: string) {
    super(message);
    this.rule = rule;
    this.fix = fix;
  }
}

export interface SetSecretResult {
  name: string;
  file: string;
  /** False when the name was already there (its value replaced). */
  added: boolean;
  /** True when `.env` was appended to the root's .gitignore. */
  gitignoreUpdated: boolean;
}

const quoteValue = (v: string) => (/^[A-Za-z0-9_\-./:@+=,]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);

const IGNORES_ENV = /^\/?(\.env|\.env\*|\*\.env)\s*$/;

/** Make sure `<root>/.gitignore` ignores `.env`; returns true when a line was appended. */
async function ensureIgnored(root: string): Promise<boolean> {
  const p = join(root, ".gitignore");
  const text = existsSync(p) ? await readFile(p, "utf8") : "";
  if (text.split(/\r?\n/).some((l) => IGNORES_ENV.test(l.trim()))) return false;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text === "" || text.endsWith("\n") ? "" : eol;
  await writeFile(p, `${text}${sep}# Machine secrets (hl secret set)${eol}.env${eol}`, "utf8");
  return true;
}

/**
 * Write NAME=value into `<root>/.env` atomically, keeping every other line and comment; replaces an existing NAME.
 * Validates the name and a non-empty single-line value. Makes sure git ignores `.env`. Never echoes the value.
 */
export async function setMachineSecret(root: string, name: string, value: string, o: { dryRun?: boolean } = {}): Promise<SetSecretResult> {
  if (!SECRET_NAME.test(name))
    throw new SecretError("bad-secret-name", `"${name}" is not a variable name`, "use upper case letters, digits and _, such as HL_TELEGRAM_TOKEN");
  if (typeof value !== "string" || value.trim() === "") throw new SecretError("bad-secret-value", `the value for ${name} is empty`, "paste the secret itself");
  if (/[\r\n\0]/.test(value)) throw new SecretError("bad-secret-value", `the value for ${name} must be one line`, "paste the secret without line breaks");
  const v = value.trim();
  const file = join(root, MACHINE_ENV_FILE);
  if (o.dryRun) {
    const added = !(name in readMachineEnv(root));
    return { name, file: MACHINE_ENV_FILE, added, gitignoreUpdated: false };
  }
  const gitignoreUpdated = await ensureIgnored(root);
  let added = true;
  await withLock(file, async () => {
    const text = existsSync(file) ? await readFile(file, "utf8") : "";
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
    const entry = `${name}=${quoteValue(v)}`;
    let at = -1;
    lines.forEach((l, i) => {
      const m = LINE.exec(l);
      if (m && m[1] === name && !l.trimStart().startsWith("#")) {
        if (at < 0) lines[i] = entry;
        else lines[i] = "\0drop";
        at = at < 0 ? i : at;
      }
    });
    if (at >= 0) added = false;
    const kept = lines.filter((l) => l !== "\0drop");
    if (at < 0) kept.push(entry);
    await replaceFile(file, `${kept.join(eol)}${eol}`);
  });
  return { name, file: MACHINE_ENV_FILE, added, gitignoreUpdated };
}
