// Scaffold logic for `hl init` and `hl project add` (stream S6).
// init writes a brand-new repo outside any workspace, so it uses node:fs directly (exclusive create);
// project add writes inside the current workspace through the file layer.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CodeWorkspace, type FileLayer, type InitOptions, PeopleToml, ProjectToml, type TomlEmitter, WorkspaceToml } from "@helmlock/core";
import { parse } from "smol-toml";

/** The static template tree shipped with this hl install. */
export const TEMPLATE_DIR = resolve(import.meta.dirname, "../../../templates/knowledge-repo");

/** A scaffold error carries a stable rule id; the verb registry maps it to exit 1. */
export class ScaffoldError extends Error {
  readonly rule: string;
  readonly file?: string;
  readonly fix?: string;
  constructor(rule: string, message: string, extra: { file?: string; fix?: string } = {}) {
    super(message);
    this.rule = rule;
    if (extra.file !== undefined) this.file = extra.file;
    if (extra.fix !== undefined) this.fix = extra.fix;
  }
}

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
export const INITIALS_RE = /^[a-z]{2,3}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** "Sam O'Brien" -> "sam-o-brien". */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const toPosix = (p: string) => p.split(sep).join("/").replace(/\\/g, "/");

/** Relative path from `from` to `to` with forward slashes; absolute (forward slashes) when on another drive. */
export function relPath(from: string, to: string): string {
  const r = relative(resolve(from), resolve(to));
  if (r === "") return ".";
  return toPosix(r);
}

export interface PlannedFile {
  /** Path relative to the new repo, forward slashes. */
  rel: string;
  text: string;
  executable?: boolean;
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(toPosix(relative(base, p)));
  }
  return out;
}

const tomlEsc = (s: string) => JSON.stringify(s).slice(1, -1);

function fill(text: string, vars: Record<string, string>, esc: (s: string) => string): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? esc(vars[k] as string) : m));
}

export function templateVars(o: InitOptions, deliveryRel: string, date: string): Record<string, string> {
  const relative = !isAbsolute(deliveryRel) && !/^[A-Za-z]:\//.test(deliveryRel);
  return {
    NAME: o.name,
    CONSOLE_NAME: `${o.name} Console`,
    AUTHOR_NAME: o.author.name,
    AUTHOR_SLUG: o.author.slug,
    INITIALS: o.author.initials,
    EMAIL: o.author.email ?? "",
    DELIVERY_REL: deliveryRel,
    DATE: date,
    // Launchers only: the delivery repo seen from the script's own folder, so they work from any cwd.
    DELIVERY_CMD: relative ? `%~dp0${deliveryRel.replace(/\//g, "\\")}` : deliveryRel.replace(/\//g, "\\"),
    DELIVERY_SH: relative ? `$here/${deliveryRel}` : deliveryRel,
  };
}

/** Render the template tree into memory. Fails on any leftover `{{` (rule "template-leftover"). */
export function renderTemplate(vars: Record<string, string>, templateDir = TEMPLATE_DIR): PlannedFile[] {
  const files: PlannedFile[] = [];
  for (const src of walk(templateDir)) {
    let rel = fill(src, vars, (s) => s);
    if (rel.endsWith(".tmpl")) rel = rel.slice(0, -".tmpl".length);
    const isData = /\.(toml|json|code-workspace|code-workspace\.template)$/.test(rel);
    let text = fill(readFileSync(join(templateDir, src), "utf8"), vars, isData ? tomlEsc : (s) => s);
    text = text.replace(/\r\n/g, "\n");
    if (rel === "people.toml" && !vars.EMAIL) text = text.replace(/^email = ""\n/m, "");
    if (rel.endsWith(".cmd")) text = text.replace(/\n/g, "\r\n");
    for (const [what, s] of [
      ["path", rel],
      ["text", text],
    ] as const) {
      const at = s.indexOf("{{");
      if (at >= 0) {
        throw new ScaffoldError("template-leftover", `template ${src}: unreplaced placeholder in ${what}: ${s.slice(at, at + 30)}`, {
          file: src,
          fix: "add the variable to templateVars() or remove it from the template",
        });
      }
    }
    files.push({ rel, text, executable: rel === "hl" });
  }
  return files;
}

/** Everything `hl init` would write, in order. */
export function planInit(o: InitOptions, date: string): { target: string; deliveryRel: string; files: PlannedFile[] } {
  if (!NAME_RE.test(o.name)) throw new ScaffoldError("bad-name", `name "${o.name}" may hold only letters, digits and dashes`, { fix: "--name Acme-Delivery" });
  if (!INITIALS_RE.test(o.author.initials))
    throw new ScaffoldError("bad-initials", `initials "${o.author.initials}" must be 2 or 3 lowercase letters`, { fix: "--initials sa" });
  if (!SLUG_RE.test(o.author.slug)) throw new ScaffoldError("bad-author", `author slug "${o.author.slug}" must be lowercase letters, digits and dashes`);
  if (!o.author.name.trim() || /[\r\n]/.test(o.author.name)) throw new ScaffoldError("bad-author", "author name must be one non-empty line");
  if (o.author.email !== undefined && /[\s"]/.test(o.author.email)) throw new ScaffoldError("bad-email", `email "${o.author.email}" is not valid`);
  const target = resolve(o.dir);
  const delivery = resolve(o.deliveryRoot);
  if (!existsSync(join(delivery, "packages", "cli", "bin", "hl.ts"))) {
    throw new ScaffoldError("bad-delivery", `${delivery} is not a Helmlock delivery repo (no packages/cli/bin/hl.ts)`, {
      fix: "--delivery <path to helmlock>",
    });
  }
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
    throw new ScaffoldError("target-exists", `${target} already exists and is not empty`, {
      fix: "pick a new folder; hl init never writes into existing content",
    });
  }
  const deliveryRel = relPath(target, delivery);
  const files = renderTemplate(templateVars(o, deliveryRel, date));
  const wsTemplate = files.find((f) => f.rel === `${o.name}.code-workspace.template`);
  if (!wsTemplate) throw new ScaffoldError("template-broken", "the template has no <NAME>.code-workspace.template");
  // The one time hl writes the personal workspace file: a copy of the template (F21, B24).
  files.push({ rel: `${o.name}.code-workspace`, text: wsTemplate.text });
  files.push({ rel: "author.local", text: `${o.author.slug}\n` });
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { target, deliveryRel, files };
}

export const REQUIRED_DIRS = ["artifacts", "archive", "logs", "activity", "projects", "shared/wiki", "shared/templates", "todos", "harness", ".obsidian"];

/** Post-scaffold validator: required folders and files exist and the state files parse. Returns problems (empty = ok). */
export function validateScaffold(root: string, name: string): string[] {
  const problems: string[] = [];
  for (const d of REQUIRED_DIRS) if (!existsSync(join(root, d))) problems.push(`missing folder ${d}/`);
  const required = [
    "workspace.toml",
    "people.toml",
    "template.toml",
    "CLAUDE.md",
    ".gitignore",
    "author.local",
    "hl",
    "hl.cmd",
    "harness/harness.toml",
    "shared/INDEX.md",
    `${name}.code-workspace`,
    `${name}.code-workspace.template`,
  ];
  for (const f of required) if (!existsSync(join(root, f))) problems.push(`missing file ${f}`);
  const check = (file: string, fn: (text: string) => unknown) => {
    try {
      if (existsSync(join(root, file))) fn(readFileSync(join(root, file), "utf8"));
    } catch (e) {
      problems.push(`${file} does not parse: ${(e as Error).message}`);
    }
  };
  check("workspace.toml", (t) => WorkspaceToml.parse(parse(t)));
  check("people.toml", (t) => {
    const people = PeopleToml.parse(parse(t));
    const author = readFileSync(join(root, "author.local"), "utf8").trim();
    if (!people.person.some((p) => p.id === author)) throw new Error(`author "${author}" is not in the roster`);
  });
  check(`${name}.code-workspace`, (t) => CodeWorkspace.parse(JSON.parse(t)));
  check(`${name}.code-workspace.template`, (t) => CodeWorkspace.parse(JSON.parse(t)));
  return problems;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: env ?? process.env, windowsHide: true });
  if (r.error) throw new ScaffoldError("git-failed", `git ${args.join(" ")}: ${r.error.message}`, { fix: "install git or pass --no-git" });
  if (r.status !== 0)
    throw new ScaffoldError("git-failed", `git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`, { fix: "fix git, or pass --no-git" });
  return r.stdout;
}

function gitConfigured(cwd: string, key: string): boolean {
  const r = spawnSync("git", ["config", "--get", key], { cwd, encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() !== "";
}

/** Writes the planned tree (exclusive create), validates it, then git init + first commit. */
export function initRepo(o: InitOptions, date: string): { created: string[]; target: string; deliveryRel: string } {
  const plan = planInit(o, date);
  const created = plan.files.map((f) => f.rel);
  if (o.dryRun) return { created, target: plan.target, deliveryRel: plan.deliveryRel };
  mkdirSync(plan.target, { recursive: true });
  for (const f of plan.files) {
    const p = join(plan.target, f.rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.text, { encoding: "utf8", flag: "wx" });
    if (f.executable && process.platform !== "win32") chmodSync(p, 0o755);
  }
  const problems = validateScaffold(plan.target, o.name);
  if (problems.length > 0)
    throw new ScaffoldError("scaffold-invalid", `the new knowledge center failed validation: ${problems.join("; ")}`, { file: plan.target });
  if (o.git !== false) {
    const cwd = plan.target;
    git(cwd, ["init", "-q", "-b", "main"]);
    git(cwd, ["add", "-A"]);
    git(cwd, ["update-index", "--chmod=+x", "hl"]);
    const env: NodeJS.ProcessEnv = { ...process.env };
    const email = o.author.email || `${o.author.slug}@localhost`;
    if (!gitConfigured(cwd, "user.name")) {
      env.GIT_AUTHOR_NAME = o.author.name;
      env.GIT_COMMITTER_NAME = o.author.name;
    }
    if (!gitConfigured(cwd, "user.email")) {
      env.GIT_AUTHOR_EMAIL = email;
      env.GIT_COMMITTER_EMAIL = email;
    }
    git(cwd, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", `Scaffold ${o.name} knowledge center`], env);
  }
  return { created, target: plan.target, deliveryRel: plan.deliveryRel };
}

// ---------- project add ----------

export const projectEmitter: TomlEmitter<ProjectToml> = {
  kind: "project",
  schema: ProjectToml,
  version: 1,
  order: { "": ["schema_version"], project: ["id", "name", "status", "owners", "repos", "goals"] },
};

export interface ProjectPlan {
  folder: string;
  path: string;
  id: string;
  /** Workspace-relative files and their new text. */
  writes: { rel: string; text: string; created: boolean }[];
  /** Human diff for the dry run. */
  diff: string[];
}

function addFolderText(rel: string, text: string, folder: string, path: string): string {
  let ws: CodeWorkspace;
  try {
    ws = CodeWorkspace.parse(JSON.parse(text));
  } catch (e) {
    throw new ScaffoldError("bad-workspace-file", `${rel} is not valid JSON: ${(e as Error).message}`, { file: rel });
  }
  if (ws.folders.some((f) => f.name === folder)) {
    throw new ScaffoldError("duplicate-folder", `${rel} already has a folder named "${folder}"`, { file: rel, fix: "pick another folder name" });
  }
  ws.folders.push({ name: folder, path });
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return `${JSON.stringify(ws, null, 2)}\n`.replace(/\n/g, eol);
}

export async function planProjectAdd(
  files: FileLayer,
  ws: { root: string; codeWorkspaceFile: string | undefined },
  o: { folder: string; path: string; id?: string },
): Promise<ProjectPlan> {
  if (!o.folder.trim() || /[\\/"]/.test(o.folder)) throw new ScaffoldError("bad-folder", `folder name "${o.folder}" may not hold slashes or quotes`);
  const id = o.id ?? slugify(o.folder);
  if (!SLUG_RE.test(id)) throw new ScaffoldError("bad-id", `project id "${id}" must be lowercase letters, digits and dashes`, { fix: "--id my-project" });
  if (!ws.codeWorkspaceFile) {
    throw new ScaffoldError("no-workspace", "no .code-workspace file found for this knowledge center", {
      fix: "run inside a knowledge center, or `hl init` one",
    });
  }
  const path = isAbsolute(o.path) ? relPath(ws.root, o.path) : toPosix(o.path);
  const wsRel = relPath(ws.root, ws.codeWorkspaceFile);
  const targets = [wsRel];
  if (await files.exists(`${wsRel}.template`)) targets.push(`${wsRel}.template`);
  const writes: ProjectPlan["writes"] = [];
  const diff: string[] = [];
  for (const rel of targets) {
    writes.push({ rel, text: addFolderText(rel, await files.readText(rel), o.folder, path), created: false });
    diff.push(`~ ${rel}`, `+   { "name": ${JSON.stringify(o.folder)}, "path": ${JSON.stringify(path)} }`);
  }
  const tomlRel = `projects/${id}/project.toml`;
  if (await files.exists(tomlRel)) {
    const cur = ProjectToml.parse((await files.readTomlRaw(tomlRel)).data);
    if (!cur.project.repos.includes(o.folder)) {
      cur.project.repos.push(o.folder);
      writes.push({ rel: tomlRel, text: "", created: false });
      diff.push(`~ ${tomlRel}`, `+   repos += ${JSON.stringify(o.folder)}`);
    }
  } else {
    writes.push({ rel: tomlRel, text: "", created: true });
    diff.push(`+ ${tomlRel}`);
  }
  const hubRel = `projects/${id}/README.md`;
  if (!(await files.exists(hubRel))) {
    const text = [
      `# ${id}`,
      "",
      "Hub note for this project: what it is, its architecture in a few lines, and links into its wiki.",
      "",
      `- Code: folder \`${o.folder}\` in the workspace file.`,
      "- State: `project.toml` (change it through `hl`).",
      "- Wiki: `wiki/` next to this note.",
      "",
    ].join("\n");
    writes.push({ rel: hubRel, text, created: true });
    diff.push(`+ ${hubRel}`);
  }
  return { folder: o.folder, path, id, writes, diff };
}

export async function applyProjectAdd(files: FileLayer, plan: ProjectPlan, author: string | undefined): Promise<string[]> {
  const changed: string[] = [];
  for (const w of plan.writes) {
    if (w.rel.endsWith("project.toml")) {
      let data: ProjectToml;
      if (w.created) {
        data = ProjectToml.parse({
          schema_version: 1,
          project: { id: plan.id, name: plan.id, status: "active", owners: author ? [author] : [], repos: [plan.folder], goals: [] },
        });
      } else {
        data = ProjectToml.parse((await files.readTomlRaw(w.rel)).data);
        if (!data.project.repos.includes(plan.folder)) data.project.repos.push(plan.folder);
      }
      await files.writeToml(w.rel, projectEmitter.kind, data);
    } else {
      await files.writeText(w.rel, w.text);
    }
    changed.push(w.rel);
  }
  return changed;
}
