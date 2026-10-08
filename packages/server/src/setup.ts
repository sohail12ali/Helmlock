// Onboarding v2 (Blueprint 34): what the /welcome wizard detects and the few writes it needs before an author exists.
//   GET  /setup/detect       git identity (a suggestion), engines, provider candidates, folders not yet projects
//   POST /setup/test-engine  {engine, model?} -> ordered checks {code, level, message, hint}; CLIs get a real hello probe
//   POST /setup/you          add or pick the roster person, write author.local, claim the git name (no author yet only)
//   POST /setup/upkeep       harness sync and the per-machine gitignore lines, repaired silently; failures reported
// Detection never returns a value: key names and where they were found, and at most a redacted first line of a probe.
import { spawnSync } from "node:child_process";
import type {
  ApiResponse,
  Context,
  EngineCapabilities,
  EngineTest,
  Runtime,
  RuntimeAdapter,
  SetupCheck,
  SetupDetect,
  SetupEngineTest,
  SetupProviderCandidate,
  SetupUpkeep,
  SetupYouResult,
} from "@helmlock/core";
import { AuthorSlug, Initials, secretSource } from "@helmlock/core";
import type { Crew } from "@helmlock/plugins/crew/crew.ts";
import { productFolders } from "@helmlock/plugins/crew/project-dir.ts";
import { readProjects } from "@helmlock/plugins/notes/notes.ts";
import { presets } from "@helmlock/plugins/providers/config.ts";
import { claimant } from "@helmlock/plugins/roster/people.ts";
import { classify } from "@helmlock/plugins/runtimes/failures.ts";
import { samePath } from "@helmlock/plugins/scaffold/scaffold.ts";
import type { Hono, Context as HonoContext } from "hono";
import { ApiError } from "./errors.ts";
import { failJson, okJson, writeBody } from "./models.ts";

type Env = Record<string, string | undefined>;

export interface SetupDeps {
  runtime: Runtime;
  ready: () => Promise<unknown>;
  hostOf: (c: HonoContext) => string;
  log: (line: string) => void;
  /** The server's write queue, so these writes never interleave with verb calls. */
  serial?: <T>(fn: () => Promise<T>) => Promise<T>;
  detect?: DetectOptions;
  /** Seconds a hello probe may take (default 45). */
  helloTimeoutSec?: number;
}

export interface DetectOptions {
  env?: Env;
  /** git config reader (tests); default `git config --get <key>` in the knowledge repo. */
  git?: (key: "user.name" | "user.email") => string | undefined;
  /** Local servers to probe; default LM Studio on 1234 and Ollama on 11434. */
  local?: { preset: string; base_url: string }[];
  /** Per local probe (default 600 ms). */
  timeoutMs?: number;
}

export const LOCAL_SERVERS = [
  { preset: "lmstudio", base_url: "http://127.0.0.1:1234/v1" },
  { preset: "ollama", base_url: "http://127.0.0.1:11434/v1" },
];

const LABELS: Record<string, string> = { "claude-code": "Claude Code", cursor: "Cursor", loop: "Helmlock loop" };
const NO_CAPS: EngineCapabilities = { resume: false, steer: false, approve: false, models: false };
const DETECT_TTL_MS = 60_000;
const HELLO_ENGINES = new Set(["claude-code", "cursor"]);
const PER_MACHINE = ["author.local", "workspace.local.toml", ".env"];

// Per runtime context: detect results (version exec is slow) and the last on-demand test of each engine.
const detectCache = new WeakMap<Context, Map<string, { at: number; bin: { command: string; version?: string } | null }>>();
const lastTests = new WeakMap<Context, Map<string, SetupEngineTest>>();
const cacheOf = <V>(m: WeakMap<Context, Map<string, V>>, ctx: Context): Map<string, V> => {
  let c = m.get(ctx);
  if (!c) {
    c = new Map();
    m.set(ctx, c);
  }
  return c;
};

async function detectCached(ctx: Context, a: RuntimeAdapter): Promise<{ command: string; version?: string } | null> {
  const cache = cacheOf(detectCache, ctx);
  const hit = cache.get(a.id);
  if (hit && Date.now() - hit.at < DETECT_TTL_MS) return hit.bin;
  const bin = await a.detect().catch(() => null);
  cache.set(a.id, { at: Date.now(), bin });
  return bin;
}

// ---------- you ----------

function gitConfig(root: string): (key: string) => string | undefined {
  return (key) => {
    const r = spawnSync("git", ["config", "--get", key], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 5000 });
    const v = r.status === 0 ? r.stdout.trim() : "";
    return v || undefined;
  };
}

const ascii = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** "Ann Lee" -> slug "ann" (or "ann-l" when taken), initials "al" (or "ale" when taken). */
export function suggestIdentity(name: string, taken: { ids: string[]; initials: string[] }): { slug?: string; initials?: string } {
  const words = ascii(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return {};
  const first = words[0] as string;
  const last = words.length > 1 ? (words[words.length - 1] as string) : "";
  const slugs = [first, last ? `${first}-${last[0]}` : "", last ? `${first}-${last}` : "", `${first}2`].filter(Boolean);
  const slug = slugs.find((s) => AuthorSlug.safeParse(s).success && !taken.ids.includes(s));
  const letters = words.map((w) => w.replace(/[^a-z]/g, "")).filter(Boolean);
  const f = letters[0] ?? "";
  const l = letters.length > 1 ? (letters[letters.length - 1] as string) : "";
  const tries = [l ? `${f[0]}${l[0]}` : f.slice(0, 2), l ? `${f[0]}${l.slice(0, 2)}` : f.slice(0, 3), l ? `${f.slice(0, 2)}${l[0]}` : ""].filter(Boolean);
  const initials = tries.find((s) => Initials.safeParse(s).success && !taken.initials.includes(s));
  return { ...(slug ? { slug } : {}), ...(initials ? { initials } : {}) };
}

// ---------- detect ----------

async function probeLocal(s: { preset: string; base_url: string }, timeoutMs: number): Promise<string[] | undefined> {
  try {
    const res = await fetch(`${s.base_url.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string");
  } catch {
    return undefined;
  }
}

export async function setupDetect(runtime: Runtime, o: DetectOptions = {}): Promise<SetupDetect> {
  const ctx = runtime.ctx;
  const info = runtime.info;
  const env = o.env ?? process.env;

  // you: git config is a suggestion only
  const git = o.git ?? gitConfig(info.root);
  const gitName = git("user.name");
  const gitEmail = git("user.email");
  const people = ctx.has("roster") ? await ctx.get("roster").list() : [];
  const person = info.author ? people.find((p) => p.id === info.author) : undefined;
  const match = (gitName ? claimant(people, gitName) : undefined) ?? (gitEmail ? claimant(people, gitEmail) : undefined);
  const sugg = gitName ? suggestIdentity(gitName, { ids: people.map((p) => p.id), initials: people.map((p) => p.initials) }) : {};

  // engines: capabilities, detect (cached) and the crew's cached test; a hello test runs only on demand
  const adapters = ctx.has("runtimes") ? ctx.get("runtimes").list() : [];
  const crewEngines = ctx.has("crew") ? await (ctx.get("crew") as Crew).engines().catch(() => []) : [];
  const last = cacheOf(lastTests, ctx);
  const engines: SetupDetect["engines"] = await Promise.all(
    adapters.map(async (a) => {
      const bin = a.id === "loop" ? { command: "" } : await detectCached(ctx, a);
      const crewTest = crewEngines.find((e) => e.id === a.id)?.test;
      const test: EngineTest = crewTest ?? {
        ok: !!bin,
        checks: [bin ? { level: "info", message: `found ${bin.command}` } : { level: "error", message: `${a.label ?? a.id} was not found on this machine` }],
      };
      const l = last.get(a.id);
      return {
        id: a.id,
        label: a.label ?? LABELS[a.id] ?? a.id,
        capabilities: a.capabilities ?? NO_CAPS,
        found: !!bin,
        ...(bin?.version ? { version: bin.version } : {}),
        test,
        ...(l ? { last: l } : {}),
      };
    }),
  );

  // providers: configured ones, keys found by name, local servers that answer
  const prov = ctx.has("providers") ? ctx.get("providers") : undefined;
  const rows = prov?.providers() ?? [];
  const models = prov?.models() ?? [];
  const configuredPreset = (id: string) => rows.some((r) => r.id === id || r.preset === id);
  const candidates: SetupProviderCandidate[] = [];
  for (const p of presets().values()) {
    if (!p.key_env || configuredPreset(p.id)) continue;
    const source = secretSource(info.root, env, p.key_env);
    if (source) candidates.push({ preset: p.id, label: p.label, base_url: p.base_url, key_env: p.key_env, source });
  }
  const local = (o.local ?? LOCAL_SERVERS).filter((s) => !configuredPreset(s.preset));
  const answered = await Promise.all(local.map((s) => probeLocal(s, o.timeoutMs ?? 600)));
  local.forEach((s, i) => {
    const list = answered[i];
    if (!list) return;
    const label = presets().get(s.preset)?.label ?? s.preset;
    candidates.push({ preset: s.preset, label, base_url: s.base_url, source: "running", models: list });
  });

  // folders of the workspace file no project names yet
  const projects = await readProjects(ctx);
  const named = new Set(projects.flatMap((p) => p.repos));
  const folders = productFolders(info)
    .filter((f) => !named.has(f.name) && f.name !== "system" && !samePath(f.abs, info.root))
    .map((f) => ({ name: f.name, path: f.abs }));

  const def = prov?.defaultModel();
  return {
    you: {
      ...(gitName ? { git_name: gitName } : {}),
      ...(gitEmail ? { git_email: gitEmail } : {}),
      ...(sugg.slug ? { suggested_slug: sugg.slug } : {}),
      ...(sugg.initials ? { suggested_initials: sugg.initials } : {}),
      ...(info.author ? { author: info.author } : {}),
      author_known: !!person,
      ...(person ? { person: { id: person.id, name: person.name } } : {}),
      ...(match ? { match: { id: match.id, name: match.name } } : {}),
    },
    engines,
    providers: {
      configured: rows.map((r) => ({ id: r.id, label: r.label, models: models.filter((m) => m.provider === r.id).length })),
      ...(def ? { default_model: def } : {}),
      candidates,
    },
    folders,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  };
}

// ---------- test-engine ----------

/** The first non-empty line, short, with anything that looks like a key or token hidden. */
export function redactLine(text: string | undefined): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line
    .replace(/\b(sk|pk|rk|ghp|gho|xox[a-z]|key|tok)[-_][A-Za-z0-9_-]{6,}/gi, "[hidden]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

const INSTALL: Record<string, string> = {
  "claude-code": "install Claude Code (npm i -g @anthropic-ai/claude-code) or set HL_CLAUDE_BIN",
  cursor: "install the Cursor CLI (https://cursor.com/cli) or set HL_CURSOR_BIN",
};
const LOGIN: Record<string, string> = {
  "claude-code": "run `claude` in a terminal once and sign in with /login",
  cursor: "run `cursor-agent login` in a terminal",
};
export const HELLO_PROMPT = "Reply with the single word: hello. Do not use any tools.";

export type HelloClass = "ok" | "login_required" | "usage_limited" | "timed_out" | "failed";

/** Classify a finished hello probe. */
export function classifyHello(r: {
  ok: boolean;
  timedOut: boolean;
  failureClass?: string;
  text?: string;
  exitCode: number | null;
  stderr?: string;
}): HelloClass {
  if (r.timedOut || r.failureClass === "timeout" || r.failureClass === "stalled") return "timed_out";
  const cls = r.ok ? "" : (r.failureClass ?? classify({ is_error: true, result: r.text ?? "" }, r.exitCode, r.stderr ?? "").class);
  if (r.ok && !cls) return "ok";
  if (cls === "auth_required") return "login_required";
  if (cls === "quota" || cls === "transient_upstream") return "usage_limited";
  return "failed";
}

async function hello(
  a: RuntimeAdapter,
  cwd: string,
  model: string | undefined,
  timeoutSec: number,
): Promise<{ cls: HelloClass; line: string; seconds: number }> {
  const t0 = Date.now();
  const handle = await a.start({ prompt: HELLO_PROMPT, cwd, mode: "plan", timeoutSec, silenceSec: timeoutSec, ...(model ? { model } : {}) });
  let timedOut = false;
  let text = "";
  let errText = "";
  let stderr = "";
  let result: { ok: boolean; text: string; failureClass?: string } | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    void handle.cancel().catch(() => {});
  }, timeoutSec * 1000);
  try {
    const read = (async () => {
      for await (const ev of handle.events) {
        if (ev.type === "text" && !text) text = ev.text;
        else if (ev.type === "error" && !errText) errText = ev.message;
        else if (ev.type === "stderr" && stderr.length < 4000) stderr += ev.text;
        else if (ev.type === "result") result = { ok: ev.ok, text: ev.text, ...(ev.failureClass ? { failureClass: ev.failureClass } : {}) };
      }
    })();
    const grace = new Promise<void>((res) => setTimeout(res, timeoutSec * 1000 + 5000).unref?.());
    await Promise.race([read, grace]);
    const done = await Promise.race([handle.done, grace.then(() => ({ ok: false, exitCode: null, timedOut: true }))]);
    const ok = done.ok && result?.ok !== false;
    const out = result?.text || text;
    const cls = classifyHello({
      ok,
      timedOut: timedOut || done.timedOut,
      ...(result?.failureClass ? { failureClass: result.failureClass } : {}),
      text: [out, errText].filter(Boolean).join("\n"),
      exitCode: done.exitCode,
      stderr,
    });
    return { cls, line: redactLine(cls === "ok" ? out : errText || out || stderr), seconds: Math.round((Date.now() - t0) / 100) / 10 };
  } finally {
    clearTimeout(timer);
  }
}

export async function testEngine(runtime: Runtime, engine: string, model: string | undefined, o: { timeoutSec?: number } = {}): Promise<SetupEngineTest> {
  const ctx = runtime.ctx;
  const a = ctx.has("runtimes") ? ctx.get("runtimes").get(engine) : undefined;
  const label = a?.label ?? LABELS[engine] ?? engine;
  const checks: SetupCheck[] = [];
  const finish = (): SetupEngineTest => {
    const t: SetupEngineTest = { engine, ok: !checks.some((c) => c.level === "error"), checks, at: new Date().toISOString() };
    cacheOf(lastTests, ctx).set(engine, t);
    if (ctx.has("crew")) (ctx.get("crew") as Crew).resetEngineCache();
    return t;
  };
  if (!a) {
    checks.push({
      code: "engine_unknown",
      level: "error",
      message: `no engine ${JSON.stringify(engine)} is registered`,
      hint: "enable its runtime plugin in workspace.toml",
    });
    return finish();
  }
  if (!HELLO_ENGINES.has(engine)) {
    // The model loop and other engines: their own test (a model reachable), else detect.
    if (a.test) {
      const t = await a.test(model ? { model } : {}).catch((e: Error) => ({ ok: false, checks: [{ level: "error" as const, message: e.message }] }));
      for (const c of t.checks) checks.push({ code: `engine_${c.level}`, level: c.level, message: c.message });
      if (!t.ok && !checks.some((c) => c.level === "error")) checks.push({ code: "engine_failed", level: "error", message: `${label} is not ready` });
    } else {
      const bin = await a.detect().catch(() => null);
      checks.push(
        bin ? { code: "found", level: "info", message: `found ${bin.command}` } : { code: "not_found", level: "error", message: `${label} was not found` },
      );
    }
    return finish();
  }

  // Claude Code and Cursor: found on PATH, then a real "say hello" run with a short timeout.
  const bin = await a.detect().catch(() => null);
  cacheOf(detectCache, ctx).set(a.id, { at: Date.now(), bin });
  if (!bin) {
    checks.push({
      code: "cli_not_found",
      level: "error",
      message: `${label} was not found on this machine`,
      ...(INSTALL[engine] ? { hint: INSTALL[engine] } : {}),
    });
    return finish();
  }
  checks.push({ code: "cli_found", level: "info", message: `found ${bin.command}${bin.version ? `, version ${redactLine(bin.version)}` : ""}` });
  const timeoutSec = o.timeoutSec ?? 45;
  let h: { cls: HelloClass; line: string; seconds: number };
  try {
    h = await hello(a, runtime.info.root, model, timeoutSec);
  } catch (e) {
    const rule = (e as { rule?: string }).rule;
    checks.push(
      rule === "runtime-missing"
        ? { code: "cli_not_found", level: "error", message: `${label} was not found on this machine`, ...(INSTALL[engine] ? { hint: INSTALL[engine] } : {}) }
        : { code: "hello_failed", level: "error", message: `${label} could not start: ${redactLine((e as Error).message)}` },
    );
    return finish();
  }
  const said = h.line ? `: "${h.line}"` : "";
  switch (h.cls) {
    case "ok":
      checks.push({ code: "hello_ok", level: "info", message: `${label} answered in ${h.seconds}s${said}` });
      break;
    case "login_required":
      checks.push({ code: "login_required", level: "error", message: `${label} is not signed in`, ...(LOGIN[engine] ? { hint: LOGIN[engine] } : {}) });
      break;
    case "usage_limited":
      checks.push({
        code: "usage_limited",
        level: "warn",
        message: `${label} is signed in but hit a usage or rate limit${said}`,
        hint: "wait for the limit to reset, or give some roles another engine",
      });
      break;
    case "timed_out":
      checks.push({
        code: "hello_timeout",
        level: "warn",
        message: `${label} did not answer within ${timeoutSec}s`,
        hint: `run it once in a terminal in the knowledge repo to see what it waits for${LOGIN[engine] ? ` (${LOGIN[engine]})` : ""}`,
      });
      break;
    default:
      checks.push({
        code: "hello_failed",
        level: "error",
        message: `${label} failed the hello test${said}`,
        hint: "run it once in a terminal to see the full error",
      });
  }
  return finish();
}

// ---------- you ----------

export async function setupYou(runtime: Runtime, body: Record<string, unknown>): Promise<SetupYouResult> {
  const ctx = runtime.ctx;
  const info = runtime.info;
  const roster = ctx.get("roster");
  const current = info.author ? await roster.get(info.author) : undefined;
  if (current)
    throw new ApiError(409, "author-set", `this machine already works as ${current.id} (${current.name})`, {
      fix: "change author.local by hand if this is someone else's machine",
    });
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : undefined);
  const id = str("id") ?? "";
  if (!AuthorSlug.safeParse(id).success) throw new ApiError(400, "bad-request", "id must be lowercase letters, digits and dashes, for example ann");
  const git = Array.isArray(body.git)
    ? [
        ...new Set(
          body.git
            .filter((g): g is string => typeof g === "string")
            .map((g) => g.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  const actor = { kind: "person" as const, id, onBehalfOf: id };
  const run = async (verb: string, input: Record<string, unknown>) => {
    const r = await runtime.run(verb, input, { json: true, interactive: false, actor });
    if (!r.ok) throw new ApiError(422, r.error.rule, r.error.message, { fix: r.error.fix ?? "" });
    return r;
  };

  let people = await roster.list();
  let person = people.find((p) => p.id === id);
  const created = !person;
  const claimed: string[] = [];
  const free = (g: string) => {
    const owner = claimant(people, g);
    return !owner || owner.id === id;
  };
  if (!person) {
    const name = str("name");
    const initials = str("initials")?.toLowerCase();
    if (!name) throw new ApiError(400, "bad-request", "name is required for a new person");
    if (!initials || !Initials.safeParse(initials).success) throw new ApiError(400, "bad-request", "initials are two or three letters, for example al");
    const email = str("email");
    const spellings = git.filter(free);
    await run("people add", { id, name, initials, ...(email ? { email } : {}), git: spellings });
    claimed.push(...spellings);
  } else
    for (const g of git)
      if (free(g) && !(person.git ?? []).some((x) => x.toLowerCase() === g.toLowerCase())) {
        await run("people claim", { id, git: g });
        claimed.push(g);
      }
  people = await roster.list();
  person = people.find((p) => p.id === id);
  if (!person) throw new ApiError(500, "internal", `${id} was not added to people.toml`);
  await ctx.get("files").writeText("author.local", `${id}\n`);
  // The console keeps running as this person: the workspace info is the live object every service reads.
  (info as { author: string | undefined }).author = id;
  return { person: { id: person.id, name: person.name, initials: person.initials }, created, claimed };
}

// ---------- upkeep ----------

export async function setupUpkeep(runtime: Runtime): Promise<SetupUpkeep> {
  const ctx = runtime.ctx;
  const out: SetupUpkeep = { repaired: [], failures: [] };
  if (ctx.has("harness")) {
    try {
      const r = await ctx.get("harness").sync();
      const written = r.filter((f) => f.status === "written");
      if (written.length) out.repaired.push(`harness sync: ${written.length} file${written.length === 1 ? "" : "s"} written`);
    } catch (e) {
      out.failures.push({ name: "harness sync", message: (e as Error).message, fix: "run hl harness sync in the knowledge repo" });
    }
  }
  if (runtime.info.codeWorkspaceFile) {
    try {
      const files = ctx.get("files");
      const text = (await files.exists(".gitignore")) ? await files.readText(".gitignore") : "";
      const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
      const missing = PER_MACHINE.filter((f) => !lines.has(f) && !lines.has(`/${f}`));
      if (missing.length) {
        const sep = text === "" || text.endsWith("\n") ? "" : "\n";
        await files.writeText(".gitignore", `${text}${sep}${missing.join("\n")}\n`);
        out.repaired.push(`gitignore: ${missing.join(", ")}`);
      }
    } catch (e) {
      out.failures.push({ name: "gitignore", message: (e as Error).message, fix: "hl doctor --repair" });
    }
  }
  return out;
}

// ---------- routes ----------

export function registerSetupRoutes(api: Hono, d: SetupDeps): void {
  const serial = d.serial ?? (<T>(fn: () => Promise<T>) => fn());
  api.get("/setup/detect", async (c) => {
    try {
      await d.ready();
      return okJson(c, await setupDetect(d.runtime, d.detect ?? {}));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
  api.post("/setup/test-engine", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      if (typeof body.engine !== "string" || !body.engine) throw new ApiError(400, "bad-request", "body needs { engine: <engine id> }");
      if (body.model !== undefined && typeof body.model !== "string") throw new ApiError(400, "bad-request", "model must be a string");
      await d.ready();
      const r = await testEngine(
        d.runtime,
        body.engine,
        (body.model as string | undefined) || undefined,
        d.helloTimeoutSec ? { timeoutSec: d.helloTimeoutSec } : {},
      );
      return c.json({ ok: true, data: r } satisfies ApiResponse<SetupEngineTest>);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
  api.post("/setup/you", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      await d.ready();
      return okJson(c, await serial(() => setupYou(d.runtime, body)));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
  api.post("/setup/upkeep", async (c) => {
    try {
      await writeBody(c, d.hostOf);
      await d.ready();
      return okJson(c, await serial(() => setupUpkeep(d.runtime)));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
}
