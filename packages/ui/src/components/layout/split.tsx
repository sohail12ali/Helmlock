// Our wrapper around react-resizable-panels (F81, F131: each widget library sits behind our own component).
// Screens use SplitGroup/SplitPanel/SplitHandle and never import the library directly.
import type { ReactNode, Ref } from "react";
import { Group, Panel, type PanelImperativeHandle, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { layoutStorage } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export type SplitPanelHandle = PanelImperativeHandle;
export const useSplitPanelRef = usePanelRef;

/** A horizontal group whose layout is remembered in localStorage (F83). */
export function SplitGroup({ id, panelIds, children, className }: { id: string; panelIds: string[]; children: ReactNode; className?: string }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `layout.${id}`, panelIds, storage: layoutStorage });
  return (
    <Group id={id} orientation="horizontal" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className={cn("h-full", className)}>
      {children}
    </Group>
  );
}

export function SplitPanel({
  id,
  children,
  className,
  defaultSize,
  minSize,
  maxSize,
  collapsible,
  collapsedSize,
  panelRef,
  onCollapsedChange,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
  collapsible?: boolean;
  collapsedSize?: number | string;
  panelRef?: Ref<PanelImperativeHandle | null>;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  return (
    <Panel
      id={id}
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      collapsible={collapsible}
      collapsedSize={collapsedSize}
      panelRef={panelRef}
      className={cn("h-full overflow-hidden", className)}
      onResize={
        onCollapsedChange
          ? (size) => {
              const min = typeof collapsedSize === "number" ? collapsedSize : 0;
              onCollapsedChange(size.inPixels <= min + 1);
            }
          : undefined
      }
    >
      {children}
    </Panel>
  );
}

/** Drag to resize; keyboard arrows work on the focused handle; double-click resets. */
export function SplitHandle({ label }: { label: string }) {
  return (
    <Separator
      aria-label={label}
      className="group relative w-px bg-border outline-none data-[separator=active]:bg-primary data-[separator=hover]:bg-primary/60 focus-visible:bg-primary"
    >
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}
