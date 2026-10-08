// Composer: Enter sends, Shift+Enter is a new line, optional mic dictation (F12).
import { SendHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MicButton } from "./MicButton";

export function Composer({
  onSend,
  disabled,
  busy,
  placeholder = "Message the assistant",
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const t = text.trim();
    if (!t || disabled || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <form
      aria-label="Send a message"
      className="flex items-end gap-1.5 border-t bg-card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="max-h-40 min-h-8 flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none field-sizing-content placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
      />
      <MicButton
        disabled={disabled}
        onText={(t) => {
          setText((cur) => (cur ? `${cur.replace(/\s+$/, "")} ${t.trim()}` : t.trim()));
          ref.current?.focus();
        }}
      />
      <Button type="submit" size="icon" disabled={disabled || busy || !text.trim()} aria-label="Send">
        <SendHorizontal />
      </Button>
    </form>
  );
}
