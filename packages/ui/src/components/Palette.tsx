// Command palette (Ctrl+K): pages, tickets, and the open ticket's artifacts from the same index as its Files tab (F148).
import { FileText, SquareKanban } from "lucide-react";
import { useNavigate } from "react-router";
import { useBoard, useTicket } from "@/api/hooks";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { INBOX_NAV, NAV } from "./layout/nav";

export function ticketFromPath(pathname: string): string | undefined {
  const m = /^\/t\/([^/]+)/.exec(pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export function Palette({ open, onOpenChange, pathname }: { open: boolean; onOpenChange: (o: boolean) => void; pathname: string }) {
  const navigate = useNavigate();
  const board = useBoard();
  const ticketId = ticketFromPath(pathname);
  const ticket = useTicket(open ? ticketId : undefined);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to a page, ticket or file…" />
      <CommandList>
        <CommandEmpty>Nothing matches. Try a ticket id such as T-001.</CommandEmpty>
        {ticketId && ticket.data && ticket.data.artifacts.length > 0 && (
          <CommandGroup heading={`Files of ${ticketId}`}>
            {ticket.data.artifacts.map((a) => (
              <CommandItem
                key={a.id}
                value={`file ${ticketId} ${a.title} ${a.path}`}
                onSelect={() => go(`/t/${encodeURIComponent(ticketId)}/${encodeURIComponent(a.id)}`)}
              >
                <FileText />
                <span className="truncate">{a.title}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{a.kind}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {[NAV[0]!, INBOX_NAV, ...NAV.slice(1)].map((n) => (
            <CommandItem key={n.id} value={`page ${n.label}`} onSelect={() => go(n.path)}>
              <n.icon />
              {n.label}
              <span className="ml-auto font-mono text-xs text-muted-foreground">{n.hotkey}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {board.data && board.data.tickets.length > 0 && (
          <CommandGroup heading="Tickets">
            {board.data.tickets.map((t) => (
              <CommandItem key={t.id} value={`${t.id} ${t.title} ${t.stage}`} onSelect={() => go(`/t/${encodeURIComponent(t.id)}`)}>
                <SquareKanban />
                <span className="font-mono text-xs">{t.id}</span>
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t.stage}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
