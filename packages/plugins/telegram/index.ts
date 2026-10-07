// Telegram channel (F4a-F4d, F66, F110). The plugin itself registers nothing: the bot is a long-poll loop that only
// `hl serve` starts, through startTelegram(runtime). The token is read from the env var NAMED in token_env (F9b).
import type { PluginModule, Runtime } from "@helmlock/core";
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

/**
 * Starts the bot when the telegram plugin is enabled, the token env var is set and at least one user id is allowed.
 * Returns undefined (after one log line explaining why) otherwise. Never throws.
 */
export function startTelegram(runtime: Runtime, o: StartTelegramOptions = {}): TelegramHandle | undefined {
  const log = o.log ?? ((l: string) => process.stderr.write(`hl serve: ${l}\n`));
  try {
    if (runtime.configError) return undefined;
    const cfgSvc = runtime.ctx.get("config");
    const row = cfgSvc.rows().find((r) => r.use === "telegram" && !r.disabled);
    if (!row) return undefined;
    const parsed = Config.safeParse(row.config ?? {});
    if (!parsed.success) {
      log(`telegram: bad settings (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}); bot not started`);
      return undefined;
    }
    const c = parsed.data;
    const token = (o.env ?? process.env)[c.token_env];
    if (!token) return undefined; // not configured on this machine: stay silent
    if (!c.allowed_user_ids.length) {
      log(`telegram: ${c.token_env} is set but allowed_user_ids is empty; bot not started (fail-closed)`);
      return undefined;
    }
    const config: BotConfig = { allowed: c.allowed_user_ids, notify: c.notify, model: c.model || undefined };
    const api = o.api ?? createBotApi(token, o.apiBase ?? DEFAULT_API_BASE);
    const { env: _e, apiBase: _b, api: _a, ...rest } = o;
    const bot = new TelegramBot({ ...rest, api, runtime, config, log }).start();
    log(`telegram: bot started for ${config.allowed.length} allowed user${config.allowed.length === 1 ? "" : "s"}`);
    return { bot, stop: () => bot.stop() };
  } catch (e) {
    log(`telegram: not started: ${(e as Error).message}`);
    return undefined;
  }
}
