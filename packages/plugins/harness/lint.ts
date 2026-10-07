// Structural lint for the prompt-facing harness: skills, agents, references, hooks.
// TypeScript port of lc-wms .kanban/core/harness_lint.py, plus the checks of .kanban/tests/test_skill_contract.py
// (every skill folder has a SKILL.md, a hidden skill is named in the rulebook, vendored skills match the lock).
// Reference checking follows explicit tokens only (backticked paths and /commands), never bare prose.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Finding } from "@helmlock/core";
import { FrontmatterError, frontmatter, type Yaml } from "./frontmatter.ts";

export const DESC_MIN = 40;
export const DESC_MAX = 300;
export const TRIGGER_RE = /\buse (whenever|when|for|after|before|during|with|to|on|at|in|as|once)\b/i;
const CMD_RE = /(?:^|(?<=\s))\/([a-z][a-z0-9-]{2,})(?![\w/.-])/g;
// biome-ignore format: a word list
export const BUILTIN_CMDS = new Set([
  "clear", "compact", "config", "context", "cost", "doctor", "help", "init", "login", "logout", "mcp", "memory", "model",
  "permissions", "review", "status", "fast", "loop", "schedule", "simplify", "code-review", "security-review", "agents",
  "hooks", "resume", "rewind", "usage", "statusline", "terminal-setup", "vim", "add-dir", "export", "ide", "artifacts",
  "plugin", "skills", "tasks", "name", "skill-name", "command",
]);
const RETIRED_AGENT_KEYS = ["inherits", "implements"];
const SKILL_SECTIONS = ["Steps", "Rules", "Output"];
const AGENT_SECTIONS: [RegExp, string][] = [
  [/^\*\*Scope:\*\*/m, "**Scope:**"],
  [/^\*\*Never:\*\*/m, "**Never:**"],
  [/^## Steps/m, "## Steps"],
  [/^## Rules/m, "## Rules"],
  [/^## Hand-off/m, "## Hand-off"],
];

export interface LintOptions {
  /** Backticked tokens starting with one of these are checked as repo paths. */
  pathPrefixes?: readonly string[];
  /** Extra slash words that are not skills (host built-ins, bot commands). */
  builtins?: readonly string[];
  /** lc-wms shape: first heading `# /<name>` and a `**Reads:** ... **Writes:**` line. */
  slashHeading?: boolean;
  readsWrites?: boolean;
  /** Max lines in a SKILL.md (Helmlock rule; lc-wms has none). 0 = off. */
  maxSkillLines?: number;
  /** Prompt files besides skills and agents, relative to root (missing ones are skipped). */
  promptFiles?: readonly string[];
  /** Folders under .claude/skills that are deliberately not skills. */
  /** Folders under .claude/skills that are not shipped skills (helpers or repo tools); never linted. */
  notSkills?: readonly string[];
}

export const HELMLOCK_LINT: Required<LintOptions> = {
  pathPrefixes: [".claude/", ".cursor/", "harness/", "packages/", "docs/", "test/"],
  builtins: [],
  slashHeading: false,
  readsWrites: false,
  maxSkillLines: 150,
  promptFiles: ["CLAUDE.md", "AGENTS.md"],
  notSkills: ["_shared"],
};

/** The settings that reproduce harness_lint.py on the lc-wms repo. */
export const LCWMS_LINT: Required<LintOptions> = {
  pathPrefixes: [".claude/", ".kanban/", ".cursor/", "knowledge-center/", "scripts/"],
  builtins: ["graphify", "new", "chats", "use", "interrupt", "stop"],
  slashHeading: true,
  readsWrites: true,
  maxSkillLines: 0,
  promptFiles: ["CLAUDE.md", "knowledge-center/wiki/ticket-workflow.md"],
  notSkills: ["_shared"],
};

const rel = (root: string, p: string) => relative(root, p).split(sep).join("/");
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const str = (v: Yaml | undefined) => (v === null || v === undefined ? "" : String(v)).trim();

function mdFiles(dir: string, skip: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (skip(p)) continue;
    if (e.isDirectory()) out.push(...mdFiles(p, skip));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function vendoredLock(skillsDir: string): Record<string, { files?: Record<string, string> }> {
  const f = join(skillsDir, "skills-lock.json");
  if (!existsSync(f)) return {};
  try {
    return (JSON.parse(read(f)) as { skills?: Record<string, { files?: Record<string, string> }> }).skills ?? {};
  } catch {
    return {};
  }
}

const digest = (p: string) => `sha256-${createHash("sha256").update(readFileSync(p).toString("latin1").replace(/\r\n/g, "\n"), "latin1").digest("hex")}`;

export function skillFormat(name: string, body: string, o: Required<LintOptions>): string[] {
  const out: string[] = [];
  const text = body.replace(/^```.*?^```/gms, "");
  const h1 = [...text.matchAll(/^# (.+)$/gm)].map((m) => (m[1] as string).trim());
  if (o.slashHeading && h1[0] !== `/${name}`) out.push(`first heading must be \`# /${name}\``);
  if (o.readsWrites && !/^\*\*Reads:\*\*.*\*\*Writes:\*\*/m.test(text)) out.push("missing the `**Reads:** … · **Writes:** …` line");
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((m) => (m[1] as string).trim());
  if (h2.join("|") !== SKILL_SECTIONS.join("|")) out.push(`## sections must be exactly ${SKILL_SECTIONS.join(", ")} (found: ${h2.join(", ") || "none"})`);
  return out;
}

export function lintHarness(root: string, opts: LintOptions = {}): Finding[] {
  const o: Required<LintOptions> = { ...HELMLOCK_LINT, ...opts };
  const findings: Finding[] = [];
  const add = (level: Finding["level"], rule: string, file: string, message: string) => findings.push({ level, rule: `lint:${rule}`, file, message });
  const skillsDir = join(root, ".claude", "skills");
  const agentsDir = join(root, ".claude", "agents");
  const lock = vendoredLock(skillsDir);
  const vendored = new Set(Object.keys(lock));
  const front = new Map<string, Record<string, Yaml>>();
  const aliases = new Set<string>();

  // ---- skills
  const skillDirs = isDir(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((n) => !o.notSkills.includes(n) || !existsSync(join(skillsDir, n, "SKILL.md")))
        .sort()
    : [];
  for (const name of skillDirs) {
    const f = join(skillsDir, name, "SKILL.md");
    const where = rel(root, f);
    if (!existsSync(f)) {
      if (!o.notSkills.includes(name)) add("error", "not-a-skill", rel(root, join(skillsDir, name)), "folder under .claude/skills has no SKILL.md");
      continue;
    }
    let data: Record<string, Yaml>;
    let body: string;
    const raw = read(f);
    try {
      ({ data, body } = frontmatter(raw));
    } catch (e) {
      add("error", "frontmatter", where, e instanceof FrontmatterError ? e.message : `frontmatter: ${(e as Error).message}`);
      continue;
    }
    front.set(name, data);
    const meta = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {};
    const al = (meta as Record<string, Yaml>).aliases;
    if (Array.isArray(al)) for (const a of al) aliases.add(String(a).replace(/^\//, ""));
    if (str(data.name) !== name) add("error", "skill-name", where, `name ${JSON.stringify(data.name ?? null)} does not match its directory`);
    const desc = str(data.description);
    const own = !vendored.has(name);
    if (!desc) add("error", "description", where, "description is missing");
    else if (own) {
      if (desc.length < DESC_MIN || desc.length > DESC_MAX)
        add("error", "description", where, `description is ${desc.length} chars — keep ${DESC_MIN}–${DESC_MAX}`);
      if (!TRIGGER_RE.test(desc) && !data["disable-model-invocation"]) add("error", "trigger", where, "description has no 'Use when/for/…' trigger clause");
    }
    if (own && /^\*\*Version:\*\*/m.test(body)) add("error", "version-footer", where, "carries a **Version:** footer — git is the history");
    if (own) for (const p of skillFormat(name, body, o)) add("error", "skill-format", where, `skill format: ${p}`);
    if (own && o.maxSkillLines > 0) {
      const n = raw.replace(/\n$/, "").split("\n").length;
      if (n > o.maxSkillLines)
        add("error", "skill-length", where, `SKILL.md is ${n} lines — keep it at most ${o.maxSkillLines}; move detail to a reference file`);
    }
  }

  // vendored skills match skills-lock.json (test_skill_contract.py)
  for (const [name, entry] of Object.entries(lock)) {
    const d = join(skillsDir, name);
    if (!isDir(d)) {
      add("error", "vendored-drift", rel(root, d), "locked but the directory is gone");
      continue;
    }
    for (const [file, want] of Object.entries(entry.files ?? {})) {
      const p = join(d, file);
      if (!existsSync(p)) add("error", "vendored-drift", rel(root, p), "locked but missing on disk");
      else if (digest(p) !== want) add("error", "vendored-drift", rel(root, p), "content changed since it was vendored");
    }
  }

  // ---- agents
  const agentFiles = isDir(agentsDir)
    ? readdirSync(agentsDir)
        .filter((n) => n.endsWith(".md"))
        .sort()
        .map((n) => join(agentsDir, n))
    : [];
  for (const f of agentFiles) {
    const where = rel(root, f);
    const raw = read(f);
    let data: Record<string, Yaml>;
    try {
      ({ data } = frontmatter(raw));
    } catch (e) {
      add("error", "frontmatter", where, (e as Error).message);
      continue;
    }
    for (const k of ["name", "description"]) if (!str(data[k])) add("error", "agent-frontmatter", where, `frontmatter '${k}' is missing`);
    for (const k of RETIRED_AGENT_KEYS) if (k in data) add("error", "agent-frontmatter", where, `'${k}' is not a Claude Code field — remove it`);
    const missing = AGENT_SECTIONS.filter(([re]) => !re.test(raw)).map(([, label]) => label);
    if (missing.length) add("error", "agent-format", where, `agent format is missing: ${missing.join(", ")}`);
  }

  // ---- references
  const prompt: string[] = [];
  for (const p of o.promptFiles) if (existsSync(join(root, p))) prompt.push(join(root, p));
  const rulesDir = join(root, "harness", "rules");
  if (isDir(rulesDir)) for (const n of readdirSync(rulesDir).sort()) if (n.endsWith(".md")) prompt.push(join(rulesDir, n));
  prompt.push(...agentFiles);
  for (const name of skillDirs)
    if (!vendored.has(name)) prompt.push(...mdFiles(join(skillsDir, name), (p) => rel(join(skillsDir, name), p).split("/").includes("evals")));
  const builtins = new Set([...BUILTIN_CMDS, ...o.builtins]);
  const commandOk = (n: string) => front.has(n) || aliases.has(n) || builtins.has(n) || (o.notSkills.includes(n) && existsSync(join(skillsDir, n, "SKILL.md")));
  for (const f of prompt) {
    const where = rel(root, f);
    const text = read(f);
    const badPaths = new Set<string>();
    const badCmds = new Set<string>();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const tok = (m[1] as string).trim();
      if (o.pathPrefixes.some((p) => tok.startsWith(p)) && !/[{}*<>|$ …]/.test(tok) && !tok.endsWith("/")) {
        const p = (tok.split("::")[0] as string).split("#")[0] as string;
        if (!existsSync(join(root, p))) badPaths.add(p);
      }
      for (const c of tok.matchAll(CMD_RE)) if (!commandOk(c[1] as string)) badCmds.add(`/${c[1]}`);
    }
    for (const p of [...badPaths].sort()) add("error", "path", where, `path does not exist: ${p}`);
    for (const c of [...badCmds].sort()) add("error", "command", where, `command resolves to no skill or alias: ${c}`);
  }

  // a skill hidden from model invocation must be named in the rulebook (test_skill_contract.py)
  const manifest = ["CLAUDE.md", "AGENTS.md"].map((n) => (existsSync(join(root, n)) ? read(join(root, n)) : "")).join("\n");
  for (const [name, data] of front)
    if (data["disable-model-invocation"] && !manifest.includes(name))
      add("error", "hidden-skill", rel(root, join(skillsDir, name)), "hidden from skill discovery and not named in CLAUDE.md or AGENTS.md");

  // ---- hooks pointing at scripts that are gone
  findings.push(...lintHooks(root));

  // ---- orphans (warn)
  const texts = prompt.map((f) => [f, read(f)] as const);
  for (const name of front.keys()) {
    const own = join(skillsDir, name);
    if (!texts.some(([f, t]) => !f.startsWith(own + sep) && t.includes(name)))
      add("warn", "orphan", `.claude/skills/${name}`, "nothing references it — reachable by description only");
  }
  return findings;
}

const SCRIPT_RE =
  /(?:"([^"]+\.(?:py|ps1|sh|cmd|ts|mjs|js))"|((?:\$CLAUDE_PROJECT_DIR\/|\$\{workspaceFolder\}\/)?[\w./:\\-]+\.(?:py|ps1|sh|cmd|ts|mjs|js))(?=\s|$))/g;

function scriptsIn(command: string): string[] {
  return [...command.matchAll(SCRIPT_RE)].map((m) => ((m[1] ?? m[2]) as string).replace(/^(\$CLAUDE_PROJECT_DIR|\$\{workspaceFolder\})[/\\]/, ""));
}

export function lintHooks(root: string): Finding[] {
  const out: Finding[] = [];
  const check = (file: string, label: string, command: string) => {
    for (const s of scriptsIn(command)) {
      const p = isAbsolute(s) ? s : join(root, s);
      if (!existsSync(p)) out.push({ level: "error", rule: "lint:hook-script", file, message: `${label} runs a missing script: ${s}` });
    }
  };
  const cursor = join(root, ".cursor", "hooks.json");
  if (existsSync(cursor)) {
    try {
      const hooks = (JSON.parse(read(cursor)) as { hooks?: unknown }).hooks;
      if (Array.isArray(hooks)) {
        for (const h of hooks as { enabled?: boolean; name?: string; command?: string }[])
          if (h.enabled !== false) check(".cursor/hooks.json", `hook '${h.name}'`, h.command ?? "");
      } else if (hooks && typeof hooks === "object") {
        for (const [ev, list] of Object.entries(hooks as Record<string, { command?: string }[]>))
          for (const h of Array.isArray(list) ? list : []) check(".cursor/hooks.json", `${ev} hook`, h.command ?? "");
      }
    } catch (e) {
      out.push({ level: "error", rule: "lint:hook-script", file: ".cursor/hooks.json", message: `not valid JSON: ${(e as Error).message}` });
    }
  }
  const settings = join(root, ".claude", "settings.json");
  if (existsSync(settings)) {
    try {
      const hooks = (JSON.parse(read(settings)) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> }).hooks ?? {};
      for (const [ev, groups] of Object.entries(hooks))
        for (const g of groups) for (const h of g.hooks ?? []) check(".claude/settings.json", `${ev} hook`, h.command ?? "");
    } catch (e) {
      out.push({ level: "error", rule: "lint:hook-script", file: ".claude/settings.json", message: `not valid JSON: ${(e as Error).message}` });
    }
  }
  return out;
}
