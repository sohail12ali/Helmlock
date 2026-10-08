// The sticky jump bar (control-center settings.js jumpBar): one small button per panel actually rendered (in page
// order), each opening its panel and scrolling to it, plus Collapse all / Expand all. Under 720px the buttons stay on
// one row and scroll sideways instead of wrapping into a tall sticky block.
import { cn } from "@/lib/utils";
import { type PanelEntry, usePanels } from "./Panel";

function inPageOrder(panels: PanelEntry[]): PanelEntry[] {
  if (typeof document === "undefined") return panels;
  return [...panels].sort((a, b) => {
    const ea = document.getElementById(a.id);
    const eb = document.getElementById(b.id);
    if (!ea || !eb) return 0;
    return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

const btn = "h-7 shrink-0 rounded-md border bg-card px-2.5 text-xs text-ink2 hover:bg-sunk hover:text-foreground";

export function JumpBar({ label = "Jump to a section", className }: { label?: string; className?: string }) {
  const { panels, setOpen, setAll } = usePanels();
  const ordered = inPageOrder(panels);
  return (
    <nav
      aria-label={label}
      className={cn(
        "sticky -top-3 z-10 -mx-1 mb-1 sm:-top-4 lg:-top-5 flex items-center gap-1.5 border-b border-border/60 bg-background px-1 pt-2 pb-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] min-[720px]:flex-wrap [&::-webkit-scrollbar]:hidden">
        {ordered.map((p) => (
          <button
            key={p.id}
            type="button"
            className={btn}
            onClick={() => {
              setOpen(p.id, true);
              // After the open state renders, so the panel's full height is there to scroll to.
              requestAnimationFrame(() => document.getElementById(p.id)?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
            }}
          >
            {p.title}
          </button>
        ))}
      </div>
      <button type="button" className={btn} onClick={() => setAll(false)}>
        Collapse all
      </button>
      <button type="button" className={btn} onClick={() => setAll(true)}>
        Expand all
      </button>
    </nav>
  );
}
