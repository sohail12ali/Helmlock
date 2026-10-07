// Assistant chat (mockups 04 and 12, F84, F11c, F12, F123): chat list, new chat, model picker, messages streamed
// from the chat's SSE frames, tool calls as compact lines, permission cards in the flow, errors with their code.
import type { ApprovalCard as Card, ChatEvent, ChatMessageData, ModelsView } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, List, Plus, Wrench } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api/client";
import { keys } from "@/api/hooks";
import { m4, useApprovals, useChat, useChatStream, useChats, useCreateChat, useModels, useSetChatModel } from "@/api/m4";
import { EmptyState, ErrorState, Loading, Mono, StatusChip } from "@/components/common";
import { Button } from "@/components/ui/button";
import { previewInput } from "@/features/agents/run-flags";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ModelPicker } from "./ModelPicker";

const CURRENT_KEY = "hl.chat.current";
function loadCurrent(): string | undefined {
  try {
    return localStorage.getItem(CURRENT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveCurrent(id: string | undefined) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage blocked */
  }
}

const TOOL_TONE: Record<NonNullable<ChatMessageData["tool"]>["status"], string> = {
  proposed: "open",
  approved: "running",
  denied: "rejected",
  done: "succeeded",
  failed: "failed",
};

function ToolLine({ m }: { m: ChatMessageData }) {
  const t = m.tool;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 font-mono text-xs text-ink2" data-tool={t?.name}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-semibold">{t?.name ?? "tool"}</span>
        <span className="min-w-0 truncate text-muted-foreground">{previewInput(t?.input)}</span>
        {t && <StatusChip status={TOOL_TONE[t.status]} label={t.status} className="ml-auto" />}
      </span>
      {(t?.result ?? m.text) && <span className="line-clamp-2 pl-5 text-muted-foreground">{t?.result ?? m.text}</span>}
    </div>
  );
}

function Message({ m, streaming }: { m: ChatMessageData; streaming?: boolean }) {
  if (m.role === "tool" || m.tool) return <ToolLine m={m} />;
  // A model often sends an empty assistant turn right before a tool call: nothing to show.
  if (m.role === "assistant" && !m.text.trim() && !streaming) return null;
  const me = m.role === "user";
  return (
    <div className={cn("flex flex-col", me ? "items-end" : "items-start")} data-role={m.role}>
      <div className={cn("max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words", me ? "bg-primary text-primary-foreground" : "bg-sunk")}>
        {m.text}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle motion-reduce:animate-none" aria-hidden />}
      </div>
      <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
        {fmtTime(m.ts)}
        {m.usage ? ` · ${m.usage.input_tokens + m.usage.output_tokens} tok` : ""}
      </span>
    </div>
  );
}

type Local = { messages: Map<string, ChatMessageData>; cards: Card[]; errors: { id: number; code: string; message: string }[]; streamingId?: string };
const emptyLocal = (): Local => ({ messages: new Map(), cards: [], errors: [] });

/** One conversation: history + live frames. Exported for tests. */
export function ChatThread({ chatId, models }: { chatId: string; models: ModelsView }) {
  const qc = useQueryClient();
  const detail = useChat(chatId);
  const approvals = useApprovals("pending");
  const setModel = useSetChatModel(chatId);
  const [local, setLocal] = useState<Local>(emptyLocal);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the chat changes
  useEffect(() => {
    setLocal(emptyLocal());
    setBusy(false);
    setSendError(undefined);
  }, [chatId]);

  const onEvent = useCallback(
    (e: ChatEvent) => {
      setLocal((cur) => {
        const next: Local = { ...cur, messages: new Map(cur.messages) };
        switch (e.type) {
          case "message": {
            // The server's copy of a message we showed optimistically replaces it.
            if (e.message.role === "user") for (const [k, v] of next.messages) if (k.startsWith("local-") && v.text === e.message.text) next.messages.delete(k);
            next.messages.set(e.message.id, e.message);
            if (e.message.role === "assistant" && !e.message.tool) next.streamingId = e.message.id;
            break;
          }
          case "delta": {
            const prev = next.messages.get(e.message_id) ?? detail.data?.messages.find((x) => x.id === e.message_id);
            next.messages.set(
              e.message_id,
              prev ? { ...prev, text: prev.text + e.text } : { id: e.message_id, role: "assistant", text: e.text, ts: new Date().toISOString() },
            );
            next.streamingId = e.message_id;
            break;
          }
          case "approval":
            next.cards = [...cur.cards.filter((c) => c.id !== e.card.id), e.card];
            break;
          case "error":
            next.errors = [...cur.errors, { id: Date.now() + cur.errors.length, code: e.code, message: e.message }];
            next.streamingId = undefined;
            break;
          case "done":
            next.streamingId = undefined;
            break;
        }
        return next;
      });
      if (e.type === "approval") void qc.invalidateQueries({ queryKey: ["approvals"] });
      if (e.type === "done" || e.type === "error") {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: keys.chat(chatId) });
        void qc.invalidateQueries({ queryKey: keys.chats });
      }
    },
    [qc, chatId, detail.data],
  );
  useChatStream(chatId, onEvent);

  const send = async (text: string) => {
    setSendError(undefined);
    setBusy(true);
    const localId = `local-${Date.now()}`;
    setLocal((cur) => {
      const messages = new Map(cur.messages);
      messages.set(localId, { id: localId, role: "user", text, ts: new Date().toISOString() });
      return { ...cur, messages, errors: [] };
    });
    try {
      await m4.send(chatId, text);
    } catch (e) {
      setSendError(e);
      setBusy(false);
    }
  };

  const messages = useMemo(() => {
    const out: ChatMessageData[] = [];
    const seen = new Set<string>();
    for (const m of detail.data?.messages ?? []) {
      seen.add(m.id);
      out.push(local.messages.get(m.id) ?? m);
    }
    for (const [id, m] of local.messages) if (!seen.has(id)) out.push(m);
    return out;
  }, [detail.data, local.messages]);

  const cards = useMemo(() => {
    const byId = new Map<string, Card>();
    for (const c of local.cards) byId.set(c.id, c);
    for (const c of approvals.data ?? []) if (c.chat_id === chatId && !byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()];
  }, [local.cards, approvals.data, chatId]);

  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new content
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [messages, cards.length, local.errors.length]);

  const summary = detail.data?.summary;
  const noModel = models.models.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={summary?.title}>
          {summary?.title ?? "Chat"}
        </span>
        <ModelPicker view={models} value={summary?.model} disabled={setModel.isPending || !summary} onChange={(m) => setModel.mutate(m)} />
      </div>
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        aria-live="polite"
        data-testid="chat-messages"
      >
        {detail.isPending && <Loading />}
        {detail.isError && <ErrorState error={detail.error} />}
        {detail.isSuccess && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Ask about tickets, search the workspace, or ask it to run a verb. Writes ask you first.</p>
        )}
        <ol className="flex flex-col gap-2.5">
          {messages.map((m) => (
            <li key={m.id}>
              <Message m={m} streaming={local.streamingId === m.id} />
            </li>
          ))}
          {cards.map((c) => (
            <li key={`card-${c.id}`}>
              <ApprovalCard card={c} showSource={false} />
            </li>
          ))}
          {local.errors.map((e) => (
            <li key={`err-${e.id}`} role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="min-w-0">
                {e.message} <Mono className="text-xs text-destructive">{e.code}</Mono>
              </span>
            </li>
          ))}
        </ol>
        {sendError !== undefined && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {sendError instanceof ApiError ? sendError.message : "Could not send."}
            {sendError instanceof ApiError && <Mono className="ml-1.5 text-xs">{sendError.rule}</Mono>}
          </p>
        )}
      </div>
      <Composer onSend={(t) => void send(t)} disabled={noModel} busy={busy} />
    </div>
  );
}

function NoModel() {
  return (
    <div className="p-3">
      <EmptyState
        title="No model configured"
        hint={
          <>
            Add a provider in{" "}
            <Link to="/settings#settings-models" className="text-primary hover:underline">
              Settings &gt; Models
            </Link>
            , then pick a model here.
          </>
        }
      />
    </div>
  );
}

/** The chat panel: list, new chat, current thread. `variant="page"` is the full-page phone view. */
export function ChatPanel({ variant = "panel", initialChat }: { variant?: "panel" | "page"; initialChat?: string }) {
  const models = useModels();
  const chats = useChats();
  const create = useCreateChat();
  const [current, setCurrentState] = useState<string | undefined>(() => initialChat ?? loadCurrent());
  const [showList, setShowList] = useState(false);
  const setCurrent = (id: string | undefined) => {
    setCurrentState(id);
    saveCurrent(id);
    setShowList(false);
  };

  useEffect(() => {
    if (initialChat) setCurrentState(initialChat);
  }, [initialChat]);

  // A stored chat that no longer exists falls back to the newest one.
  const list = chats.data ?? [];
  const known = current && list.some((c) => c.id === current);
  const active = known ? current : chats.isSuccess ? list[0]?.id : current;

  const view: ModelsView | undefined = models.data;
  const newChat = () => create.mutate(view?.default ? { model: view.default } : {}, { onSuccess: (s) => s && setCurrent(s.id) });

  return (
    <section aria-label="Assistant" className={cn("flex h-full min-h-0 flex-col bg-card", variant === "page" && "bg-background")}>
      <header className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" onClick={() => setShowList((s) => !s)} aria-label={showList ? "Back to chat" : "Chats"} aria-pressed={showList}>
          {showList ? <ChevronLeft /> : <List />}
        </Button>
        <h2 className="flex-1 text-sm font-semibold">Assistant</h2>
        <Button variant="outline" size="sm" onClick={newChat} disabled={create.isPending || !view || view.models.length === 0}>
          <Plus /> New chat
        </Button>
      </header>
      {create.isError && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {create.error instanceof ApiError ? create.error.message : "Could not create a chat."}
        </p>
      )}

      {models.isPending ? (
        <Loading />
      ) : models.isError ? (
        models.error instanceof ApiError && models.error.status === 404 ? (
          <NoModel />
        ) : (
          <div className="p-3">
            <ErrorState error={models.error} />
          </div>
        )
      ) : !view || view.models.length === 0 ? (
        <NoModel />
      ) : showList ? (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto" aria-label="Chats">
          {list.length === 0 && <li className="p-3 text-sm text-muted-foreground">No chats yet.</li>}
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCurrent(c.id)}
                className={cn("flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent", c.id === active && "bg-accent")}
              >
                <span className="w-full truncate font-medium">{c.title || "Untitled chat"}</span>
                <span className="flex gap-2 text-xs text-muted-foreground">
                  <Mono>{c.model}</Mono>
                  {c.channel === "telegram" && <span>telegram</span>}
                  <span>{fmtDateTime(c.updated)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : active ? (
        <ChatThread chatId={active} models={view} />
      ) : (
        <div className="p-3">
          <EmptyState title="No chats yet." hint="Start one with New chat. It uses the default model; change it per chat." />
        </div>
      )}
    </section>
  );
}

export default ChatPanel;
