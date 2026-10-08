// The loop's tools (Blueprint 33, deepseek-harness tool-fs and tool-skill without the ceremony): read, glob, grep,
// edit (literal, exactly one match, read-before-edit and stale checks), write, shell, hl, todo_write, skill, ask_user
// and finish. Each tool is a JSON-schema function; approvals are decided by the loop before run() for write and shell.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RunEvent, ToolSpec } from "@helmlock/core";
import { globToRegExp } from "../runtimes/glob.ts";
import { lineDiff } from "./diff.ts";
import { assertReadable, assertWritable, display, type PathPolicy, pathKey, resolvePath, ToolError } from "./paths.ts";
import type { ProcOptions, ProcResult } from "./proc.ts";

export type ToolKind = "read" | "write" | "shell" | "hl" | "control";

export interface ToolOutput {
  text: string;
  isError?: boolean;
  /** "finish" ends the turn; "ask" ends it waiting for the person. */
  end?: "finish" | "ask";
}

export type CommandRunner = (args: string[], o: ProcOptions) => Promise<ProcResult>;
export type ShellRunner = (command: string, o: ProcOptions) => Promise<ProcResult>;

export interface SkillInfo {
  name: string;
  description: string;
  file: string;
}

export interface ToolEnv {
  policy: PathPolicy;
  /** Read-before-edit: path key -> sha256 of the content last read or written in this session. */
  observed: Map<string, string>;
  emit(ev: RunEvent): void;
  signal: AbortSignal;
  /** Environment for child processes (HL_RUN_ID and friends). */
  env: Record<string, string>;
  skills: Map<string, SkillInfo>;
  shell: ShellRunner;
  hl: CommandRunner;
  rg: CommandRunner;
}

export interface LoopTool {
  spec: ToolSpec;
  kind: ToolKind;
  /** Write tools: validate the target before asking anyone (path, protection, read-before-edit). */
  target?(args: Record<string, unknown>, env: ToolEnv): string;
  run(args: Record<string, unknown>, env: ToolEnv): Promise<ToolOutput>;
}

export const READ_MAX = 60_000;
export const READ_FILE_MAX = 10 * 1024 * 1024;
export const SKILL_MAX = 40_000;
export const GLOB_MAX = 300;
export const GREP_MAX_LINES = 200;
export const SHELL_TIMEOUT_SEC = 120;
export const SHELL_TIMEOUT_MAX_SEC = 600;
const WALK_MAX = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".hl-cache"]);

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[cut: ${s.length - n} more characters]` : s);

function atomicWrite(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.hl-tmp-${randomBytes(3).toString("hex")}`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, abs);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* gone */
    }
    throw e;
  }
}

/** Read-before-edit (deepseek-harness fs-observation-policy): unseen -> FS_NOT_OBSERVED, changed -> FS_STALE_VERSION. */
function checkObserved(env: ToolEnv, abs: string): void {
  const seen = env.observed.get(pathKey(abs));
  const shown = display(env.policy, abs);
  if (!seen) throw new ToolError("FS_NOT_OBSERVED", `read ${shown} before changing it`);
  if (sha(readFileSync(abs)) !== seen) throw new ToolError("FS_STALE_VERSION", `${shown} changed since you last read it: read it again first`);
}

function emitDiff(env: ToolEnv, abs: string, before: string, after: string): { added: number; removed: number } {
  const file = display(env.policy, abs);
  const d = lineDiff(file, before, after);
  env.emit({ type: "diff", file, added: d.added, removed: d.removed, ...(d.patch ? { patch: d.patch } : {}) });
  return d;
}

function walk(base: string, visit: (abs: string, rel: string) => boolean): void {
  let seen = 0;
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(join(base, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++seen > WALK_MAX) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(r);
      } else if (e.isFile() && !visit(join(base, r), r)) return;
    }
  }
}

const read: LoopTool = {
  kind: "read",
  spec: {
    name: "read",
    description: "Read a text file. Lines come numbered. Use offset (1-based line) and limit for large files. Read a file before you edit or overwrite it.",
    parameters: obj({ path: { type: "string" }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1 } }, ["path"]),
  },
  async run(a, env) {
    const abs = resolvePath(env.policy, a.path);
    assertReadable(abs);
    if (!existsSync(abs)) throw new ToolError("FS_NOT_FOUND", `no file ${display(env.policy, abs)}`);
    const st = statSync(abs);
    if (st.isDirectory()) throw new ToolError("IS_FOLDER", `${display(env.policy, abs)} is a folder: use glob to list it`);
    if (st.size > READ_FILE_MAX) throw new ToolError("FILE_TOO_LARGE", `${display(env.policy, abs)} is ${st.size} bytes: search it with grep instead`);
    const buf = readFileSync(abs);
    if (buf.includes(0)) throw new ToolError("NOT_TEXT", `${display(env.policy, abs)} is not a text file`);
    env.observed.set(pathKey(abs), sha(buf));
    const lines = buf.toString("utf8").split(/\r?\n/);
    const from = Math.max(1, int(a.offset) ?? 1);
    const limit = Math.max(1, int(a.limit) ?? 2000);
    const slice = lines.slice(from - 1, from - 1 + limit);
    let out = "";
    let last = from - 1;
    for (const [i, l] of slice.entries()) {
      const line = `${from + i}\t${l}\n`;
      if (out.length + line.length > READ_MAX) break;
      out += line;
      last = from + i;
    }
    if (last < lines.length) out += `[lines ${from}-${last} of ${lines.length}; read on with offset=${last + 1}]\n`;
    return { text: out || "(empty file)\n" };
  },
};

const glob: LoopTool = {
  kind: "read",
  spec: {
    name: "glob",
    description: 'List files matching a glob under a folder (default: the work folder). "**" spans folders, "*" stays in one: e.g. "**/*.ts".',
    parameters: obj({ pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
  },
  async run(a, env) {
    const pattern = str(a.pattern);
    if (!pattern) throw new ToolError("BAD_ARGS", "give a pattern");
    const base = resolvePath(env.policy, a.path ?? ".");
    const re = globToRegExp(pattern);
    const hits: string[] = [];
    let more = false;
    walk(base, (abs, rel) => {
      if (!re.test(rel)) return true;
      if (hits.length >= GLOB_MAX) {
        more = true;
        return false;
      }
      hits.push(display(env.policy, abs));
      return true;
    });
    if (!hits.length) return { text: "no files match" };
    return { text: `${hits.join("\n")}${more ? `\n[more than ${GLOB_MAX} files: narrow the pattern]` : ""}` };
  },
};

function grepJs(base: string, isFile: boolean, re: RegExp, fileRe: RegExp | undefined, env: ToolEnv): string[] {
  const out: string[] = [];
  const scan = (abs: string, rel: string) => {
    if (fileRe && !fileRe.test(rel) && !fileRe.test(basename(rel))) return true;
    try {
      if (statSync(abs).size > 2 * 1024 * 1024) return true;
      const buf = readFileSync(abs);
      if (buf.includes(0)) return true;
      const lines = buf.toString("utf8").split(/\r?\n/);
      for (const [i, l] of lines.entries()) {
        re.lastIndex = 0;
        if (re.test(l)) out.push(`${display(env.policy, abs)}:${i + 1}:${l.slice(0, 300)}`);
        if (out.length >= GREP_MAX_LINES) return false;
      }
    } catch {
      /* unreadable */
    }
    return true;
  };
  if (isFile) scan(base, basename(base));
  else walk(base, scan);
  return out;
}

const grep: LoopTool = {
  kind: "read",
  spec: {
    name: "grep",
    description: "Search file contents with a regular expression (ripgrep syntax). Optional path (file or folder), glob filter on file names, ignore_case.",
    parameters: obj({ pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignore_case: { type: "boolean" } }, ["pattern"]),
  },
  async run(a, env) {
    const pattern = str(a.pattern);
    if (!pattern) throw new ToolError("BAD_ARGS", "give a pattern");
    const target = resolvePath(env.policy, a.path ?? ".");
    if (!existsSync(target)) throw new ToolError("FS_NOT_FOUND", `no file or folder ${display(env.policy, target)}`);
    const isFile = statSync(target).isFile();
    const fileGlob = str(a.glob);
    const args = ["--line-number", "--no-heading", "--color", "never", "--max-columns", "300", "--max-count", "50"];
    if (a.ignore_case === true) args.push("-i");
    if (fileGlob) args.push("--glob", fileGlob);
    args.push("-e", pattern, "--", isFile ? basename(target) : ".");
    const cwd = isFile ? dirname(target) : target;
    const r = await env.rg(args, { cwd, env: env.env, timeoutMs: 60_000, signal: env.signal });
    let lines: string[];
    if (r.spawnError) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, a.ignore_case === true ? "i" : "");
      } catch (e) {
        throw new ToolError("BAD_PATTERN", (e as Error).message);
      }
      lines = grepJs(target, isFile, re, fileGlob ? globToRegExp(fileGlob) : undefined, env);
    } else {
      if (r.code === 1) return { text: "no matches" };
      if (r.code !== 0) throw new ToolError("GREP_FAILED", r.out.trim().slice(0, 500) || `rg exit ${r.code}`);
      // rg prints "path:line:text" relative to the search folder (".\src\a.ts" on Windows); show it like read paths.
      lines = r.out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          if (isFile) return `${display(env.policy, target)}:${l}`;
          const m = /^(.*?):(\d+):(.*)$/.exec(l);
          return m ? `${display(env.policy, join(cwd, m[1] as string))}:${m[2]}:${m[3]}` : l;
        });
    }
    if (!lines.length) return { text: "no matches" };
    const more = lines.length > GREP_MAX_LINES;
    return { text: `${lines.slice(0, GREP_MAX_LINES).join("\n")}${more ? `\n[more than ${GREP_MAX_LINES} lines: narrow the search]` : ""}` };
  },
};

function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

const edit: LoopTool = {
  kind: "write",
  spec: {
    name: "edit",
    description:
      "Replace one exact piece of text in a file. old_string must appear exactly once (add surrounding lines to make it unique). Read the file first; whitespace must match.",
    parameters: obj({ path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, ["path", "old_string", "new_string"]),
  },
  target(a, env) {
    const abs = resolvePath(env.policy, a.path);
    assertWritable(env.policy, abs);
    if (!existsSync(abs)) throw new ToolError("FS_NOT_FOUND", `no file ${display(env.policy, abs)}: use write to create it`);
    checkObserved(env, abs);
    return abs;
  },
  async run(a, env) {
    const abs = (edit.target as NonNullable<LoopTool["target"]>)(a, env);
    let oldS = str(a.old_string);
    let newS = str(a.new_string);
    if (oldS === undefined || newS === undefined) throw new ToolError("BAD_ARGS", "give old_string and new_string");
    if (!oldS) throw new ToolError("BAD_ARGS", "old_string is empty: use write for a new file");
    if (oldS === newS) throw new ToolError("NO_CHANGE", "old_string and new_string are the same");
    const before = readFileSync(abs, "utf8");
    let n = count(before, oldS);
    if (n === 0 && before.includes("\r\n") && !oldS.includes("\r\n")) {
      // The file uses CRLF and the model wrote LF: match and write in the file's own line endings.
      const crlf = oldS.replace(/\n/g, "\r\n");
      if (count(before, crlf) > 0) {
        oldS = crlf;
        newS = newS.replace(/\r?\n/g, "\r\n");
        n = count(before, oldS);
      }
    }
    const shown = display(env.policy, abs);
    if (n === 0) throw new ToolError("NO_MATCH", `old_string was not found in ${shown}: read the file again and copy the text exactly`);
    if (n > 1) throw new ToolError("MULTIPLE_MATCHES", `old_string appears ${n} times in ${shown}: include more surrounding lines so it is unique`);
    const i = before.indexOf(oldS);
    const after = before.slice(0, i) + newS + before.slice(i + oldS.length);
    atomicWrite(abs, after);
    env.observed.set(pathKey(abs), sha(after));
    const d = emitDiff(env, abs, before, after);
    return { text: `edited ${shown} (+${d.added} -${d.removed})` };
  },
};

const write: LoopTool = {
  kind: "write",
  spec: {
    name: "write",
    description: "Create a file with the given content. Overwriting an existing file needs a read of it first in this session.",
    parameters: obj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  },
  target(a, env) {
    const abs = resolvePath(env.policy, a.path);
    assertWritable(env.policy, abs);
    if (existsSync(abs)) {
      if (statSync(abs).isDirectory()) throw new ToolError("IS_FOLDER", `${display(env.policy, abs)} is a folder`);
      checkObserved(env, abs);
    }
    return abs;
  },
  async run(a, env) {
    const abs = (write.target as NonNullable<LoopTool["target"]>)(a, env);
    const content = str(a.content);
    if (content === undefined) throw new ToolError("BAD_ARGS", "give content");
    const existed = existsSync(abs);
    const before = existed ? readFileSync(abs, "utf8") : "";
    atomicWrite(abs, content);
    env.observed.set(pathKey(abs), sha(content));
    const d = emitDiff(env, abs, before, content);
    return { text: `${existed ? "overwrote" : "created"} ${display(env.policy, abs)} (+${d.added} -${d.removed})` };
  },
};

const shell: LoopTool = {
  kind: "shell",
  spec: {
    name: "shell",
    description: `Run a shell command in the work folder (${process.platform === "win32" ? "cmd.exe" : "sh"}). A person approves each command. Use the hl tool for hl verbs. timeout_sec defaults to ${SHELL_TIMEOUT_SEC}.`,
    parameters: obj({ command: { type: "string" }, timeout_sec: { type: "integer", minimum: 1, maximum: SHELL_TIMEOUT_MAX_SEC } }, ["command"]),
  },
  async run(a, env) {
    const command = str(a.command)?.trim();
    if (!command) throw new ToolError("BAD_ARGS", "give a command");
    const sec = Math.min(SHELL_TIMEOUT_MAX_SEC, Math.max(1, int(a.timeout_sec) ?? SHELL_TIMEOUT_SEC));
    const r = await env.shell(command, { cwd: env.policy.cwd, env: env.env, timeoutMs: sec * 1000, signal: env.signal });
    if (r.spawnError) return { text: `error: cannot start the shell: ${r.spawnError}`, isError: true };
    const head = r.timedOut ? `timed out after ${sec}s (killed)` : `exit code ${r.code}`;
    return { text: `${head}\n${r.out}`, isError: r.timedOut || r.code !== 0 };
  },
};

/** "hl run report --outcome done" -> ["run", "report", "--outcome", "done", "--json"]. */
export function hlArgs(a: Record<string, unknown>, split: (s: string) => string[]): string[] {
  let args = Array.isArray(a.args) ? a.args.map(String) : typeof a.command === "string" ? split(a.command) : [];
  if (args[0] === "hl" || args[0] === "hl.cmd" || args[0] === "./hl") args = args.slice(1);
  if (!args.length) throw new ToolError("BAD_ARGS", 'give the verb and its arguments, e.g. "ticket show T-014"');
  if (!args.includes("--json")) args.push("--json");
  return args;
}

export function hlTool(split: (s: string) => string[]): LoopTool {
  return {
    kind: "hl",
    spec: {
      name: "hl",
      description:
        'Run a Helmlock verb (hl) in the knowledge workspace and get its JSON result. Pass the command line without "hl", e.g. "ticket show T-014", "context", "run report --outcome done --summary \\"...\\"". State files change only through this tool.',
      parameters: obj({ command: { type: "string" } }, ["command"]),
    },
    async run(a, env) {
      const args = hlArgs(a, split);
      const r = await env.hl(args, { cwd: env.policy.knowledgeRoot, env: env.env, timeoutMs: 120_000, signal: env.signal });
      if (r.spawnError) return { text: `error: cannot run hl: ${r.spawnError}`, isError: true };
      if (r.timedOut) return { text: `error: hl ${args.join(" ")} timed out\n${r.out}`, isError: true };
      return { text: r.out.trim() || `exit code ${r.code}`, isError: r.code !== 0 };
    },
  };
}

const TODO_STATUS: Record<string, "pending" | "in_progress" | "done"> = {
  pending: "pending",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  done: "done",
  completed: "done",
};

const todoWrite: LoopTool = {
  kind: "control",
  spec: {
    name: "todo_write",
    description: "Replace your visible todo list (the person sees it). Keep one item in_progress at a time.",
    parameters: obj(
      {
        items: {
          type: "array",
          items: obj({ text: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, ["text", "status"]),
        },
      },
      ["items"],
    ),
  },
  async run(a, env) {
    if (!Array.isArray(a.items)) throw new ToolError("BAD_ARGS", "give items: [{text, status}]");
    const items = a.items
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .filter((x) => typeof x.text === "string" && x.text.trim())
      .map((x) => ({ text: String(x.text).trim(), status: TODO_STATUS[String(x.status)] ?? "pending" }));
    env.emit({ type: "todo", items });
    return { text: `todo list updated (${items.length} items)` };
  },
};

const skill: LoopTool = {
  kind: "control",
  spec: {
    name: "skill",
    description: "Load a skill's instructions by name (the skill list is in your instructions). Follow them for the task at hand.",
    parameters: obj({ name: { type: "string" } }, ["name"]),
  },
  async run(a, env) {
    const name = str(a.name)?.trim().replace(/^\//, "");
    const s = name ? env.skills.get(name) : undefined;
    if (!s) throw new ToolError("NO_SKILL", `no skill "${name ?? ""}"; known: ${[...env.skills.keys()].join(", ") || "none"}`);
    return { text: cap(readFileSync(s.file, "utf8"), SKILL_MAX) };
  },
};

const askUser: LoopTool = {
  kind: "control",
  spec: {
    name: "ask_user",
    description: "Ask the person a question you cannot answer yourself. Ends this turn; the answer comes as the next message.",
    parameters: obj({ question: { type: "string" } }, ["question"]),
  },
  async run(a) {
    const q = str(a.question)?.trim();
    if (!q) throw new ToolError("BAD_ARGS", "give the question");
    return { text: q, end: "ask" };
  },
};

const finish: LoopTool = {
  kind: "control",
  spec: {
    name: "finish",
    description: "End your turn with a short summary of what you did. Report the outcome with the hl tool (run report) first.",
    parameters: obj({ summary: { type: "string" } }, ["summary"]),
  },
  async run(a) {
    return { text: str(a.summary)?.trim() || "finished", end: "finish" };
  },
};

/** The tools a mode offers: plan mode gets no write or shell tools at all. */
export function toolsFor(mode: string, split: (s: string) => string[]): LoopTool[] {
  const base = [read, glob, grep, hlTool(split), todoWrite, skill, askUser, finish];
  if (mode === "plan") return base;
  return [read, glob, grep, edit, write, shell, ...base.slice(3)];
}
