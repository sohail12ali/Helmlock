import { useSearchParams } from "react-router";
import { ChatPanel } from "./ChatPanel";

/** Full-page chat for phone widths (and links from approval cards). */
export function ChatPage() {
  const [params] = useSearchParams();
  return (
    <div className="h-full">
      <ChatPanel variant="page" initialChat={params.get("c") ?? undefined} />
    </div>
  );
}
