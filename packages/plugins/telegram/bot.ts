// The Telegram bot (F4a-F4d), ported from control-center console/server/telegram_bot.py:
// one long-poll loop for the life of `hl serve`, a fail-closed allowlist, approval buttons, edit-in-place answers.
import type { Actor, ApprovalCardData, Events, Runtime, Services } from "@helmlock/core";
import { type BotApi, clip, type InlineKeyboard, type TgCallbackQuery, type TgMessage, type TgUpdate } from "./api.ts";
import { DmStore } from "./state.ts";

export interface BotConfig {
  /** Numeric Telegram user ids allowed to talk to the bot. Empty = nobody. */
  allowed: number[];
  notify: boolean;
  /** Model for new chats; undefined = the assistant's default. */
  model: string | undefined;
}

export interface BotOptions {
  api: BotApi;
  runtime: Runtime;
  config: BotConfig;
  log: (line: string) => void;
  /** Long-poll timeout in seconds (default 50). */
  pollTimeoutSec?: number;
  /** First backoff after an error; doubles up to maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Minimum gap between edits of the working message (default 1000 ms). */
  editIntervalMs?: number;
  /** Service overrides (tests); otherwise read from the runtime, mounting plugins when needed. */
  services?: Partial<Pick<Services, "assistant" | "approvalQueue" | "runManager" | "context">>;
}

type Lazy = "assistant" | "approvalQueue" | "runManager" | "context";

const HELP = [
  "Helmlock bot. Send a message to chat with the assistant.",
  "/status - in-flight tickets, waiting approvals, active runs",
  "/new [title] - start a new chat",
  "/use <chat id prefix> - switch chat (no argument lists recent chats)",
  "/stop - cancel the current answer or a run started from this chat",
  "/todo <text> - add a todo",
  "/ticket <title> - create a ticket",
  "/help - this list",
].join("\n");

const OUTCOME = { allow: "Allowed", chat: "Allowed for this chat", deny: "Denied" } as const;
const CB = /^ap:([acd]):(.+)$/;

interface CardMsg {
  dm: number;
  messageId: number;
  text: string;
  done: boolean;
}

export class TelegramBot {
  private readonly o: BotOptions;
  private readonly store: DmStore;
  private readonly abort = new AbortController();
  private offset: number | undefined;
  private loop: Promise<void> | undefined;
  private readonly inflight = new Set<Promise<void>>();
  /** Telegram DM id -> controller of the assistant turn in flight there. */
  private readonly turns = new Map<number, AbortController>();
  /** Approval id -> the card messages sent for it. */
  private readonly cards = new Map<string, CardMsg[]>();
  /** DM id -> run ids seen on approval cards of that DM's chat (what /stop may cancel). */
  private readonly runsByDm = new Map<number, Set<string>>();
  private readonly disposers: (() => void | Promise<void>)[] = [];
  private mounted: Promise<unknown> | undefined;

  constructor(o: BotOptions) {
    this.o = o;
    this.store = new DmStore(o.runtime.info.root);
  }

  get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  start(): this {
    const ctx = this.o.runtime.ctx;
    this.disposers.push(
      ctx.on("approval.requested", (p) => this.track(this.onApprovalRequested(p))),
      ctx.on("approval.decided", (p) => this.track(this.onApprovalDecided(p))),
      ctx.on("run.finished", (p) => this.track(this.onRunFinished(p))),
      ctx.on("ticket.blocked", (p) => this.track(this.onTicketBlocked(p))),
    );
    this.loop = this.run();
    return this;
  }

  /** Stops the loop (aborting the poll in flight), cancels open turns and waits for handlers to finish. */
  async stop(): Promise<void> {
    if (!this.abort.signal.aborted) this.abort.abort();
    for (const t of this.turns.values()) t.abort();
    for (const d of this.disposers.splice(0)) await d();
    await this.loop;
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  // ---------- the loop ----------

  private async run(): Promise<void> {
    await this.drain();
    let backoff = this.o.backoffMs ?? 1000;
    while (!this.stopped) {
      let updates: TgUpdate[];
      try {
        updates = await this.o.api.call<TgUpdate[]>(
          "getUpdates",
          { offset: this.offset, timeout: this.o.pollTimeoutSec ?? 50, allowed_updates: ["message", "callback_query"] },
          this.abort.signal,
        );
        backoff = this.o.backoffMs ?? 1000;
      } catch (e) {
        if (this.stopped) break;
        const retry = (e as { retryAfter?: number }).retryAfter;
        const wait = retry ? retry * 1000 : backoff;
        this.o.log(`telegram: getUpdates failed (${(e as Error).message}); retrying in ${wait} ms`);
        await this.sleep(wait);
        backoff = Math.min(backoff * 2, this.o.maxBackoffMs ?? 60_000);
        continue;
      }
      for (const u of updates ?? []) {
        this.offset = u.update_id + 1;
        if (this.stopped) break;
        try {
          await this.handle(u);
        } catch (e) {
          // One malformed update must not stop the loop.
          this.o.log(`telegram: update ${u.update_id} failed: ${(e as Error).message}`);
        }
      }
    }
  }

  /** Acknowledge what queued while the server was down without acting on it (a restart must not replay commands). */
  private async drain(): Promise<void> {
    try {
      const old = await this.o.api.call<TgUpdate[]>("getUpdates", { offset: -1, timeout: 0 }, this.abort.signal);
      for (const u of old ?? []) this.offset = u.update_id + 1;
    } catch {
      // the loop reports errors
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      const t = setTimeout(done, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          done();
        },
        { once: true },
      );
    });
  }

  private track(p: Promise<void>): void {
    const q = p.catch((e) => this.o.log(`telegram: ${(e as Error).message}`)).finally(() => this.inflight.delete(q));
    this.inflight.add(q);
  }

  // ---------- routing ----------

  private allowed(id: number | undefined): boolean {
    return id !== undefined && this.o.config.allowed.includes(id);
  }

  private async handle(u: TgUpdate): Promise<void> {
    const from = u.callback_query?.from ?? u.message?.from;
    if (!this.allowed(from?.id)) {
      // Fail-closed (F4c): a stranger gets nothing, and this one line is the only trace.
      this.o.log(`telegram: dropped update ${u.update_id} from user ${from?.id ?? "unknown"} (not in allowed_user_ids)`);
      return;
    }
    if (u.callback_query) await this.onCallback(u.callback_query);
    else if (u.message) await this.onMessage(u.message);
  }

  /** The person behind an allowed id is the workspace author (single person for now). */
  private actor(): Actor | undefined {
    const a = this.o.runtime.info.author;
    return a ? { kind: "person", id: a, onBehalfOf: a } : undefined;
  }

  private async svc<K extends Lazy>(key: K): Promise<Services[K] | undefined> {
    const given = this.o.services?.[key];
    if (given) return given as Services[K];
    const ctx = this.o.runtime.ctx;
    if (!ctx.has(key)) {
      this.mounted ??= this.o.runtime.mountAll().catch(() => undefined);
      await this.mounted;
    }
    return ctx.has(key) ? ctx.get(key) : undefined;
  }

  // ---------- Bot API helpers ----------

  private async send(dm: number, text: string, keyboard?: InlineKeyboard): Promise<TgMessage | undefined> {
    try {
      return await this.o.api.call<TgMessage>("sendMessage", { chat_id: dm, text: clip(text), ...(keyboard ? { reply_markup: keyboard } : {}) });
    } catch (e) {
      this.o.log(`telegram: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** Editing without reply_markup also removes the buttons. "Not modified" is not an error worth reporting. */
  private async edit(dm: number, messageId: number, text: string): Promise<void> {
    try {
      await this.o.api.call("editMessageText", { chat_id: dm, message_id: messageId, text: clip(text) });
    } catch (e) {
      if (!/not modified/i.test((e as Error).message)) this.o.log(`telegram: ${(e as Error).message}`);
    }
  }

  private async typing(dm: number): Promise<void> {
    try {
      await this.o.api.call("sendChatAction", { chat_id: dm, action: "typing" });
    } catch {
      // cosmetic
    }
  }

  private async broadcast(text: string): Promise<void> {
    for (const dm of this.o.config.allowed) await this.send(dm, text);
  }

  // ---------- messages and commands ----------

  private async onMessage(m: TgMessage): Promise<void> {
    // DMs only: in a group, others would read the answers.
    if (m.chat.type !== "private") return;
    const text = (m.text ?? "").trim();
    if (!text) return;
    const dm = m.chat.id;
    if (!text.startsWith("/")) {
      this.track(this.say(dm, text));
      return;
    }
    const sp = text.indexOf(" ");
    const word = (sp < 0 ? text : text.slice(0, sp)).replace(/@.*$/, "").toLowerCase();
    const rest = sp < 0 ? "" : text.slice(sp + 1).trim();
    const reply = await this.command(dm, word, rest);
    if (reply) await this.send(dm, reply);
  }

  private async command(dm: number, word: string, rest: string): Promise<string | undefined> {
    switch (word) {
      case "/start":
      case "/help":
        return HELP;
      case "/status":
        return this.status();
      case "/new":
        return this.newChat(dm, rest);
      case "/use":
        return this.use(dm, rest);
      case "/stop":
        return this.stopCmd(dm);
      case "/todo":
        return this.verb("todo add", { text: rest }, rest ? undefined : "Usage: /todo <text>", (d) => `Added todo ${(d as { id: string }).id}.`);
      case "/ticket":
        return this.verb("ticket new", { title: rest }, rest ? undefined : "Usage: /ticket <title>", (d) => {
          const t = (d as { ticket: { ticket: { id: string; title: string; stage: string } } }).ticket.ticket;
          return `Created ticket ${t.id} (${t.stage}): ${t.title}`;
        });
      default:
        return `Unknown command ${word}. Send /help for the list.`;
    }
  }

  /** Writes from commands go through the verb registry as the person (same path as the CLI). */
  private async verb(id: string, input: Record<string, unknown>, usage: string | undefined, said: (data: unknown) => string): Promise<string> {
    if (usage) return usage;
    const actor = this.actor();
    if (!actor) return "No author is set on this machine (author.local), so nothing can be written.";
    const r = await this.o.runtime.run(id, input, { actor });
    if (!r.ok) return `Refused: ${r.error.message}${r.error.fix ? `\nFix: ${r.error.fix}` : ""}`;
    return said(r.data);
  }

  private async status(): Promise<string> {
    const lines: string[] = [];
    const context = await this.svc("context");
    if (context) {
      const s = await context.session();
      const blocked = s.in_flight.filter((t) => t.blocked).length;
      lines.push(`${s.in_flight.length} in flight, ${blocked} blocked.`);
      for (const t of s.in_flight.slice(0, 8)) lines.push(`- ${t.id} ${t.stage}${t.blocked ? " (blocked)" : ""}: ${t.title}`);
    }
    const queue = await this.svc("approvalQueue");
    if (queue) {
      const p = queue.pending();
      lines.push(`${p.length} approval${p.length === 1 ? "" : "s"} waiting.`);
      for (const c of p.slice(0, 5)) lines.push(`- ${c.action}: ${c.detail}${c.local_only ? " (console only)" : ""}`);
    }
    const runs = await this.svc("runManager");
    if (runs) {
      const a = runs.active();
      lines.push(`${a.length} active run${a.length === 1 ? "" : "s"}.`);
      for (const r of a.slice(0, 5)) lines.push(`- ${r.id} ${r.agent ?? r.runtime}${r.ticket ? ` on ${r.ticket}` : ""}`);
    }
    return lines.length ? lines.join("\n") : "Nothing to report (no status services are enabled).";
  }

  private async newChat(dm: number, title: string): Promise<string> {
    const assistant = await this.svc("assistant");
    if (!assistant) return "The assistant is not enabled in this workspace.";
    const c = await assistant.create({ channel: "telegram", ...(title ? { title } : {}), ...(this.o.config.model ? { model: this.o.config.model } : {}) });
    this.store.set(dm, { chat: c.id });
    return `New chat ${c.id.slice(0, 8)}${c.title ? `: ${c.title}` : ""}.`;
  }

  private async use(dm: number, prefix: string): Promise<string> {
    const assistant = await this.svc("assistant");
    if (!assistant) return "The assistant is not enabled in this workspace.";
    const chats = [...(await assistant.list())].sort((a, b) => b.updated.localeCompare(a.updated));
    const current = this.store.get(dm).chat;
    const row = (c: { id: string; title: string; channel: string }) => `${c.id === current ? "* " : "- "}${c.id.slice(0, 8)} ${c.title} (${c.channel})`;
    if (!prefix) return chats.length ? ["Recent chats:", ...chats.slice(0, 10).map(row)].join("\n") : "No chats yet. Send a message to start one.";
    const hits = chats.filter((c) => c.id.startsWith(prefix));
    if (hits.length === 1) {
      const c = hits[0] as (typeof chats)[number];
      this.store.set(dm, { chat: c.id });
      return `Now using chat ${c.id.slice(0, 8)}: ${c.title}`;
    }
    if (!hits.length) return `No chat starts with ${prefix}. Send /use to list them.`;
    return [`${hits.length} chats start with ${prefix}; be more specific:`, ...hits.slice(0, 10).map(row)].join("\n");
  }

  private async stopCmd(dm: number): Promise<string> {
    const turn = this.turns.get(dm);
    if (turn) {
      turn.abort();
      return "Stopped the current answer.";
    }
    const runs = await this.svc("runManager");
    const mine = this.runsByDm.get(dm);
    const live = runs?.active().filter((r) => mine?.has(r.id)) ?? [];
    const author = this.o.runtime.info.author ?? "telegram";
    for (const r of live) await runs?.cancel(r.id, author);
    return live.length ? `Cancelled run ${live.map((r) => r.id).join(", ")}.` : "Nothing to stop.";
  }

  // ---------- chat with the assistant ----------

  private async say(dm: number, text: string): Promise<void> {
    const assistant = await this.svc("assistant");
    if (!assistant) {
      await this.send(dm, "The assistant is not enabled in this workspace. Commands still work: /help");
      return;
    }
    const actor = this.actor();
    if (!actor) {
      await this.send(dm, "No author is set on this machine (author.local).");
      return;
    }
    if (this.turns.has(dm)) {
      await this.send(dm, "Still answering the last message. Send /stop to cancel it.");
      return;
    }
    const ctl = new AbortController();
    this.turns.set(dm, ctl);
    const typing = setInterval(() => void this.typing(dm), 4000);
    try {
      let chat = this.store.get(dm).chat;
      if (!chat) {
        chat = (await assistant.create({ channel: "telegram", ...(this.o.config.model ? { model: this.o.config.model } : {}) })).id;
        this.store.set(dm, { chat });
      }
      await this.typing(dm);
      const working = await this.send(dm, "Working…");
      let buf = "";
      let final: string | undefined;
      let error: string | undefined;
      let lastEdit = 0;
      let shown = "Working…";
      const gap = this.o.editIntervalMs ?? 1000;
      const show = async (t: string) => {
        if (!working || t === shown) return;
        shown = t;
        lastEdit = Date.now();
        await this.edit(dm, working.message_id, t);
      };
      // Low trust is the assistant's job for channel "telegram" (F66).
      for await (const ev of assistant.send(chat, text, { actor, channel: "telegram", signal: ctl.signal })) {
        if (ev.type === "delta") {
          buf += ev.text;
          if (Date.now() - lastEdit >= gap) await show(`${buf} …`);
        } else if (ev.type === "message" && ev.message.role === "assistant") final = ev.message.text;
        else if (ev.type === "approval") await this.sendCard(dm, ev.card);
        else if (ev.type === "error") error = ev.message;
        else if (ev.type === "done") break;
      }
      const answer = ctl.signal.aborted ? `${buf || final || ""}\n\n(stopped)`.trim() : error ? `Error: ${error}` : final || buf || "(no answer)";
      if (working) await show(answer);
      else await this.send(dm, answer);
    } catch (e) {
      await this.send(dm, ctl.signal.aborted ? "Stopped." : `Error: ${(e as Error).message}`);
    } finally {
      clearInterval(typing);
      this.turns.delete(dm);
    }
  }

  // ---------- approvals ----------

  private cardText(c: Pick<ApprovalCardData, "action" | "detail" | "tool" | "input_preview" | "local_only">): string {
    const lines = [`Approval: ${c.action}`, c.detail];
    if (c.tool) lines.push(`Tool: ${c.tool}${c.input_preview ? ` ${c.input_preview}` : ""}`);
    if (c.local_only) lines.push("", "This needs the console: clipboard, screenshots and shell are never approved from Telegram.");
    return lines.join("\n");
  }

  private async sendCard(
    dm: number,
    card: Pick<ApprovalCardData, "id" | "action" | "detail" | "tool" | "input_preview" | "local_only" | "run_id">,
  ): Promise<void> {
    const sent = this.cards.get(card.id) ?? [];
    if (sent.some((s) => s.dm === dm)) return;
    if (card.run_id) {
      const s = this.runsByDm.get(dm) ?? new Set<string>();
      s.add(card.run_id);
      this.runsByDm.set(dm, s);
    }
    const text = this.cardText(card);
    const keyboard: InlineKeyboard | undefined = card.local_only
      ? undefined
      : {
          inline_keyboard: [
            [
              { text: "Allow", callback_data: `ap:a:${card.id}` },
              { text: "Allow for this chat", callback_data: `ap:c:${card.id}` },
            ],
            [{ text: "Deny", callback_data: `ap:d:${card.id}` }],
          ],
        };
    // Reserve the slot before awaiting so the event and the stream never send the same card twice.
    const entry: CardMsg = { dm, messageId: 0, text, done: false };
    sent.push(entry);
    this.cards.set(card.id, sent);
    const m = await this.send(dm, text, keyboard);
    if (m) entry.messageId = m.message_id;
  }

  private async onApprovalRequested(p: Events["approval.requested"]): Promise<void> {
    const queue = await this.svc("approvalQueue");
    const full = queue?.pending().find((c) => c.id === p.id);
    const card = full ?? { id: p.id, action: p.action, detail: p.detail, local_only: p.localOnly, ...(p.runId ? { run_id: p.runId } : {}) };
    // A card that came with an assistant turn goes to that DM only; the rest to every allowed person.
    const owners = p.chatId ? this.o.config.allowed.filter((dm) => this.store.get(dm).chat === p.chatId) : [];
    for (const dm of owners.length ? owners : this.o.config.allowed) await this.sendCard(dm, card);
  }

  private async onCallback(q: TgCallbackQuery): Promise<void> {
    const m = CB.exec(q.data ?? "");
    const answerCb = (text: string) => this.o.api.call("answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => undefined);
    if (!m) {
      await answerCb("Unrecognised button.");
      return;
    }
    const [, k, id] = m as unknown as [string, "a" | "c" | "d", string];
    const outcome = k === "a" ? OUTCOME.allow : k === "c" ? OUTCOME.chat : OUTCOME.deny;
    const queue = await this.svc("approvalQueue");
    const by = this.o.runtime.info.author ?? `telegram:${q.from.id}`;
    let said: string;
    try {
      if (!queue) throw new Error("approvals are not enabled in this workspace");
      queue.answer(id, k === "d" ? "deny" : "allow", by, "telegram", k === "c" ? "chat" : "once");
      said = outcome;
    } catch (e) {
      // Already answered, expired, or console-only: say which instead of leaving a live-looking button.
      said = (e as Error).message;
    }
    await answerCb(said);
    const msg = q.message;
    if (msg) {
      const entry = this.cards.get(id)?.find((c) => c.dm === msg.chat.id);
      if (entry) entry.done = true;
      await this.edit(msg.chat.id, msg.message_id, `${entry?.text ?? msg.text ?? ""}\n\n— ${said} by ${by} (Telegram)`);
    }
  }

  private async onApprovalDecided(p: Events["approval.decided"]): Promise<void> {
    const sent = this.cards.get(p.id);
    if (!sent) return;
    const said = p.channel === "timeout" ? "Expired (no answer, denied)" : `${p.decision === "allow" ? "Allowed" : "Denied"} by ${p.by} (${p.channel})`;
    for (const c of sent) {
      if (c.done || !c.messageId) continue;
      c.done = true;
      await this.edit(c.dm, c.messageId, `${c.text}\n\n— ${said}`);
    }
    if (p.channel === "timeout" && this.o.config.notify) {
      const first = sent[0]?.text.split("\n")[0]?.replace(/^Approval: /, "") ?? p.id;
      for (const dm of new Set(sent.map((c) => c.dm))) await this.send(dm, `Approval timed out and was denied: ${first}`);
    }
    this.cards.delete(p.id);
  }

  // ---------- notifications ----------

  private async onRunFinished(p: Events["run.finished"]): Promise<void> {
    if (!this.o.config.notify) return;
    const runs = await this.svc("runManager");
    const st = runs?.get(p.runId);
    const first = st?.first_result_line ? `: ${st.first_result_line}` : "";
    await this.broadcast(`Run ${p.runId}${p.ticket ? ` on ${p.ticket}` : ""} ${p.ok ? "finished" : "failed"}${first}`);
  }

  private async onTicketBlocked(p: Events["ticket.blocked"]): Promise<void> {
    if (!this.o.config.notify || !p.blocked) return;
    await this.broadcast(`${p.id} is blocked${p.by ? ` by ${p.by}` : ""}${p.next ? `. Next: ${p.next}` : ""}`);
  }
}
