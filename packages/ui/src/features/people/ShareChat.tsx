// "Share this chat" (Blueprint 31): chats are Private (this machine) by default. Sharing copies the chat into
// people/<you>/chats/, committed and visible to the team; file reads are stripped. Verb: chat share.
import type { ChatSummary } from "@helmlock/core/contracts";
import { Share2 } from "lucide-react";
import { useState } from "react";
import { INVALIDATE_M6, isShared, usePeople } from "@/api/m6";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";
import { ScopeBadge } from "./scope";

/** Private or Personal, by whether the chat was shared. */
export function ChatScopeBadge({ chat, me, className }: { chat: ChatSummary | undefined; me?: string; className?: string }) {
  if (!chat) return null;
  return isShared(chat) ? <ScopeBadge scope="personal" me={me} label="Shared" className={className} /> : <ScopeBadge scope="private" className={className} />;
}

export function ShareChat({ chat }: { chat: ChatSummary | undefined }) {
  const people = usePeople();
  const me = people.data?.me?.id;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const v = useVerbRun("chat share", INVALIDATE_M6.chats);
  if (!chat) return null;
  const shared = done || isShared(chat);
  if (!open)
    return (
      <span className="flex items-center gap-1.5">
        <ChatScopeBadge chat={shared ? ({ ...chat, shared: true } as ChatSummary) : chat} me={me} />
        {!shared && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Share this chat">
            <Share2 /> Share
          </Button>
        )}
      </span>
    );
  return (
    <div role="alertdialog" aria-label="Share this chat" className="flex w-full flex-col gap-2 rounded-md border bg-sunk p-2 text-sm">
      <p>
        Sharing copies this chat into <code className="font-mono text-xs">people/{me ?? "<you>"}/chats/</code>. It is committed to git and{" "}
        <strong>visible to the team</strong>. Contents of files the assistant read are stripped. The original stays Private on this machine.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={v.pending}
          onClick={async () => {
            const input: Record<string, unknown> = { id: chat.id };
            if (chat.title) input.title = chat.title;
            const r = await v.run(input);
            if (r.ok) {
              setDone(true);
              setOpen(false);
            }
          }}
        >
          {v.pending ? "Sharing" : "Share with the team"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep private
        </Button>
      </div>
      {v.last && !v.last.result.ok && <VerbResult result={v.last.result} />}
    </div>
  );
}
