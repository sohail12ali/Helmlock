import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { SplitGroup, SplitHandle, SplitPanel } from "./split";

/**
 * Main column plus an optional right panel (F81). Wide: resizable, collapsible split.
 * Under 900 px the right panel becomes a drawer (F82). Main is a container (`@container`) so cards reflow by its width.
 */
export function PageLayout({
  id,
  children,
  right,
  rightTitle = "Details",
  onCloseRight,
  className,
}: {
  id: string;
  children: ReactNode;
  right?: ReactNode;
  rightTitle?: string;
  onCloseRight?: () => void;
  className?: string;
}) {
  const { narrow } = useShell();
  const main = <div className={cn("@container h-full overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-5", className)}>{children}</div>;

  if (narrow || !right) {
    return (
      <>
        {main}
        {narrow && (
          <Sheet open={!!right} onOpenChange={(o) => !o && onCloseRight?.()}>
            <SheetContent side="right" title={rightTitle} className="w-[min(28rem,92vw)]">
              <div className="h-full overflow-y-auto p-4 pt-10">{right}</div>
            </SheetContent>
          </Sheet>
        )}
      </>
    );
  }

  return (
    <SplitGroup id={`page-${id}`} panelIds={["main", "right"]}>
      <SplitPanel id="main" minSize="35%">
        {main}
      </SplitPanel>
      <SplitHandle label={`Resize ${rightTitle.toLowerCase()} panel`} />
      <SplitPanel id="right" defaultSize={340} minSize={260} maxSize="60%" collapsible collapsedSize={0}>
        <aside aria-label={rightTitle} className="relative h-full overflow-y-auto bg-card p-4">
          {onCloseRight && (
            <button
              type="button"
              onClick={onCloseRight}
              aria-label={`Close ${rightTitle.toLowerCase()}`}
              className="absolute top-3 right-3 rounded-sm p-0.5 opacity-70 hover:bg-accent hover:opacity-100"
            >
              <XIcon className="size-4" />
            </button>
          )}
          {right}
        </aside>
      </SplitPanel>
    </SplitGroup>
  );
}
