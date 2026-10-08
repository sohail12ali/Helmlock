// Telegram channel (F4a-F4d, F66, F110). The plugin itself registers nothing: the bot is a long-poll loop that only
// `hl serve` starts, through superviseTelegram(runtime). The token is read by the NAME in token_env (F9b), from the
// process environment or this machine's gitignored .env (milestone 7), so a token saved later starts the bot without
// a restart: the supervisor re-checks on "secret.saved" and after `config set`.
import type { ComposedRow, Context, PluginModule, Runtime } from "@helmlock/core";
import { composeRows, machineSecret } from "@helmlock/core";
import { z } from "zod";
import { type BotApi, createBotApi, DEFAULT_API_BASE } from "./api.ts";
import { type BotConfig, type BotOptions, TelegramBot } from "./bot.ts";

export { TelegramBot } from "./bot.ts";

const ids = z
  .union([z.string(), z.array(z.union([z.string(), z.number()]))])
  .default("")
  .transform((v) =>
    (Array.isArray(v) ? v.map(String) : v.split(/[\s,;]+/))
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number),
  );

export const Config = z
  .object({
    token_env: z.string().default("HL_TELEGRAM_TOKEN"),
    allowed_user_ids: ids,
    notify: z.boolean().default(true),
    model: z.string().default(""),
  })
  .loose();
export type TelegramConfig = z.infer<typeof Config>;

const plugin: PluginModule<typeof Config> = {
  name: "telegram",
  Config,
  apply() {
    // Nothing to register: the bot lives only as long as `hl serve` (F110).
  },
};
export default plugin;

export interface StartTelegramOptions extends Partial<Omit<BotOptions, "runtime" | "config" | "api">> {
  env?: Record<string, string | undefined>;
  /** Bot API base URL (tests point it at a fake server). */
  apiBase?: string;
  api?: BotApi;
}

export interface TelegramHandle {
  bot: TelegramBot;
  stop(): Promise<void>;
}

type Env = Record<string, string | undefined>;

/** The telegram row's settings read fresh from workspace.toml and workspace.local.toml (launch flags still win). */
export async function readTelegramRow(ctx: Context): Promise<ComposedRow | undefined> {
  const mounted = ctx.has("config") ? ctx.get("config").rows() : [];
  const flagged = mounted.find((r) => r.use === "telegram" && r.source.layer === "flags");
  let rows: ComposedRow[] = mounted;
  if (!flagged && ctx.has("files")) {
    try {
      const files = ctx.get("files");
      const read = async (rel: string) => ((await files.exists(rel)) ? (await files.readTomlRaw(rel)).data : undefined);
      rows = composeRows({ workspace: await read("workspace.toml"), local: await read("workspace.local.toml") }).rows;
    } catch {
      rows = mounted; // a broken file: keep what was mounted
    }
  }
  return rows.find((r) => r.use === "telegram" && !r.disabled);
}

type Decision = { token: string; config: BotConfig; tokenEnv: string } | { reason?: string };

function decide(root: string, row: ComposedRow | undefined, env: Env): Decision {
  if (!row) return {};
  const parsed = Config.safeParse(row.config ?? {});
  if (!parsed.success) return { reason: `telegram: bad settings (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}); bot not started` };
  const c = parsed.data;
  const token = machineSecret(root, c.token_env, env);
  if (!token) return {}; // not configured on this machine: stay silent
  if (!c.allowed_user_ids.length) return { reason: `telegram: ${c.token_env} is set but allowed_user_ids is empty; bot not started (fail-closed)` };
  return { token, tokenEnv: c.token_env, config: { allowed: c.allowed_user_ids, notify: c.notify, model: c.model || undefined } };
}

function launch(runtime: Runtime, o: StartTelegramOptions, d: { token: string; config: BotConfig }, log: (l: string) => void): TelegramHandle {
  const api = o.api ?? createBotApi(d.token, o.apiBase ?? DEFAULT_API_BASE);
  const { env: _e, apiBase: _b, api: _a, ...rest } = o;
  const bot = new TelegramBot({ ...rest, api, runtime, config: d.config, log }).start();
  log(`telegram: bot started for ${d.config.allowed.length} allowed user${d.config.allowed.length === 1 ? "" : "s"}`);
  return { bot, stop: () => bot.stop() };
}

/**
 * Starts the bot when the telegram plugin is enabled, the token is set (environment or .env) and at least one user id
 * is allowed. Uses the settings mounted at start. Returns undefined (after one log line explaining why) otherwise.
 * Never throws.
 */
export function startTelegram(runtime: Runtime, o: StartTelegramOptions = {}): TelegramHandle | undefined {
  const log =
    o.log ??
    ((l: string) =>
      process.stderr.write(`hl serve: ${l}
`));
  try {
    if (runtime.configError) return undefined;
    const row = runtime.ctx
      .get("config")
      .rows()
      .find((r) => r.use === "telegram" && !r.disabled);
    const d = decide(runtime.info.root, row, o.env ?? process.env);
    if (!("token" in d)) {
      if (d.reason) log(d.reason);
      return undefined;
    }
    return launch(runtime, o, d, log);
  } catch (e) {
    log(`telegram: not started: ${(e as Error).message}`);
    return undefined;
  }
}

export interface TelegramSupervisor {
  /** The running bot, if any. */
  readonly handle: TelegramHandle | undefined;
  /** Re-read the settings and the token; start, restart or stop the bot to match. Never throws. */
  recheck(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The bot for the life of `hl serve`: starts it when it can and re-checks when a secret is saved or a setting changes
 * (events "secret.saved" and "verb.done" for `config set`), so no restart is needed. Settings are read fresh each time.
 */
export function superviseTelegram(runtime: Runtime, o: StartTelegramOptions = {}): TelegramSupervisor {
  const log =
    o.log ??
    ((l: string) =>
      process.stderr.write(`hl serve: ${l}
`));
  let running: { key: string; h: TelegramHandle } | undefined;
  let lastReason: string | undefined;
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const apply = async () => {
    if (stopped || runtime.configError) return;
    let d: Decision;
    try {
      d = decide(runtime.info.root, await readTelegramRow(runtime.ctx), o.env ?? process.env);
    } catch (e) {
      d = { reason: `telegram: not started: ${(e as Error).message}` };
    }
    const key = "token" in d ? JSON.stringify([d.token, d.config]) : undefined;
    if (key && running?.key === key) return;
    if (running) {
      const r = running;
      running = undefined;
      await r.h.stop();
      if (!key) log("telegram: bot stopped (settings or token changed)");
    }
    if (!("token" in d)) {
      if (d.reason && d.reason !== lastReason) log(d.reason);
      lastReason = d.reason;
      return;
    }
    lastReason = undefined;
    try {
      running = { key: key as string, h: launch(runtime, o, d, log) };
    } catch (e) {
      log(`telegram: not started: ${(e as Error).message}`);
    }
  };
  const safe = async () => {
    try {
      await apply();
    } catch (e) {
      log(`telegram: ${(e as Error).message}`);
    }
  };
  const recheck = () => {
    chain = chain.then(safe);
    return chain;
  };

  const ctx = runtime.ctx;
  const offs = [
    ctx.on("secret.saved", () => void recheck()),
    ctx.on("verb.done", (e) => {
      if (e.verb === "config set" && e.code === 0 && !e.dryRun) void recheck();
    }),
  ];
  void recheck();
  return {
    get handle() {
      return running?.h;
    },
    recheck,
    async stop() {
      stopped = true;
      for (const off of offs) await off();
      await chain;
      const r = running;
      running = undefined;
      await r?.h.stop();
    },
  };
}
