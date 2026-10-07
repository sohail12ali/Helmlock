// Minimal Telegram Bot API client over fetch (no SDK). Only the methods the bot uses.
// https://core.telegram.org/bots/api

export const DEFAULT_API_BASE = "https://api.telegram.org";

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  text?: string;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
export interface InlineButton {
  text: string;
  callback_data: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export class TelegramApiError extends Error {
  readonly status: number;
  /** Seconds Telegram asks us to wait (429). */
  readonly retryAfter: number | undefined;
  constructor(method: string, status: number, description: string, retryAfter?: number) {
    super(`telegram ${method}: ${status} ${description}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Telegram's hard limit is 4096 characters per message. */
export const MAX_TEXT = 4000;
export const clip = (s: string): string => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

export interface BotApi {
  call<T = unknown>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

/** The token goes into the URL path, as the Bot API requires; it is never logged (errors name only the method). */
export function createBotApi(token: string, base = DEFAULT_API_BASE, fetchImpl: typeof fetch = fetch): BotApi {
  const root = `${base.replace(/\/+$/, "")}/bot${token}`;
  return {
    async call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
      const res = await fetchImpl(`${root}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        ...(signal ? { signal } : {}),
      });
      let body: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | undefined;
      try {
        body = (await res.json()) as typeof body;
      } catch {
        body = undefined;
      }
      if (!res.ok || !body?.ok) throw new TelegramApiError(method, res.status, body?.description ?? res.statusText, body?.parameters?.retry_after);
      return body.result as T;
    },
  };
}
