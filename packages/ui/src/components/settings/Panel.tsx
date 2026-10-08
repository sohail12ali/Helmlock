// Collapsible panels (control-center core.js panel/collapsible/helpNote/group). A page wraps its panels in
// <PanelsProvider storageKey>: every panel's open state is remembered per id in one localStorage map (guarded: storage
// can be blocked), the panel named by the URL hash opens, and <JumpBar> lists the panels actually rendered.
import { ChevronDown, Info } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChipTone } from "./Chip";

type OpenMap = Record<string, boolean>;

function readMap(key: string): OpenMap {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as OpenMap) : {};
  } catch {
    return {};
  }
}
function writeMap(key: string, map: OpenMap): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* storage blocked: the state lasts for this page only */
  }
}

export interface PanelEntry {
  id: string;
  title: string;
}

interface PanelsCtx {
  isOpen(id: string, fallback: boolean): boolean;
  setOpen(id: string, open: boolean): void;
  setAll(open: boolean): void;
  register(e: PanelEntry): () => void;
  panels: PanelEntry[];
  /** The panel the URL hash names (opened and scrolled to on load). */
  target: string | undefined;
}

const Ctx = createContext<PanelsCtx | null>(null);

export function usePanels(): PanelsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanels outside PanelsProvider");
  return v;
}

/** Holds the open state of every panel inside it. `hash` (with or without "#") opens that panel. */
export function PanelsProvider({ storageKey, hash, children }: { storageKey: string; hash?: string; children: ReactNode }) {
  const target = hash?.replace(/^#/, "") || undefined;
  const [map, setMap] = useState<OpenMap>(() => {
    const m = readMap(storageKey);
    return target ? { ...m, [target]: true } : m;
  });
  const [panels, setPanels] = useState<PanelEntry[]>([]);

  const setOpen = useCallback(
    (id: string, open: boolean) =>
      setMap((m) => {
        const next = { ...m, [id]: open };
        writeMap(storageKey, next);
        return next;
      }),
    [storageKey],
  );
  // A hash that changes while the page is open (a link to another panel) opens that panel too.
  useEffect(() => {
    if (target) setMap((m) => (m[target] ? m : { ...m, [target]: true }));
  }, [target]);
  const register = useCallback((e: PanelEntry) => {
    setPanels((ps) => [...ps.filter((p) => p.id !== e.id), e]);
    return () => setPanels((ps) => ps.filter((p) => p.id !== e.id));
  }, []);

  const value = useMemo<PanelsCtx>(
    () => ({
      isOpen: (id, fallback) => map[id] ?? fallback,
      setOpen,
      setAll: (open) =>
        setMap((m) => {
          const next = { ...m };
          for (const p of panels) next[p.id] = open;
          writeMap(storageKey, next);
          return next;
        }),
      register,
      panels,
      target,
    }),
    [map, setOpen, register, panels, storageKey, target],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const ICON_TONE: Record<ChipTone, string> = {
  neutral: "bg-sunk text-ink2",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-accent text-primary",
  accent: "bg-accent text-primary",
};

/** The ⓘ note: what the panel is and where it is stored. Accent-soft ground, 2px left rule. */
function HelpNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="rounded-md border-l-2 border-primary/50 bg-accent px-2.5 py-2 text-[11.8px] leading-relaxed text-ink2">
      {children}
    </div>
  );
}

export function Panel({
  id,
  title,
  icon,
  tone = "accent",
  help,
  defaultOpen = false,
  headExtra,
  className,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  tone?: ChipTone;
  /** What this panel is and where its settings are stored (behind the ⓘ button). */
  help?: ReactNode;
  defaultOpen?: boolean;
  /** Small things in the header (chips); clicks on controls here do not fold the panel. */
  headExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ctx = usePanels();
  const open = ctx.isOpen(id, defaultOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const uid = useId();
  const ref = useRef<HTMLElement>(null);
  const { register, target } = ctx;

  useEffect(() => register({ id, title }), [register, id, title]);
  useEffect(() => {
    if (target === id) ref.current?.scrollIntoView?.({ block: "start" });
  }, [target, id]);

  const toggle = () => ctx.setOpen(id, !open);
  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${uid}-title`}
      data-panel={id}
      data-open={open}
      className={cn("flex min-w-0 scroll-mt-14 flex-col overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(16,20,28,.05)]", className)}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut over the whole header; the chevron button is the keyboard and screen reader path */}
      <header
        className={cn("flex cursor-pointer items-center gap-2 px-[13px] pt-2.5 pb-[9px] select-none hover:bg-sunk/50", open && "border-b border-border/60")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,input,select,a,label,textarea")) return;
          toggle();
        }}
      >
        {icon && <span className={cn("grid size-[21px] shrink-0 place-items-center rounded-md [&>svg]:size-3", ICON_TONE[tone])}>{icon}</span>}
        <h2 id={`${uid}-title`} className="min-w-0 flex-1 truncate text-[10.5px] font-bold tracking-[.07em] text-ink3 uppercase">
          {title}
        </h2>
        {headExtra}
        {help && (
          <button
            type="button"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md border border-transparent text-ink3 hover:bg-sunk",
              helpOpen && "border-primary/30 bg-accent text-primary",
            )}
            aria-label={`What ${title} does`}
            title={`What ${title} does`}
            aria-expanded={helpOpen}
            aria-controls={`${uid}-help`}
            onClick={() => {
              setHelpOpen(!helpOpen);
              if (!helpOpen && !open) ctx.setOpen(id, true);
            }}
          >
            <Info className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink3 hover:bg-sunk"
          aria-expanded={open}
          aria-controls={`${uid}-body`}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          onClick={toggle}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </header>
      {open && (
        <div id={`${uid}-body`} className="flex min-w-0 flex-col gap-2.5 px-[13px] pt-[11px] pb-3">
          {help && helpOpen && <HelpNote id={`${uid}-help`}>{help}</HelpNote>}
          {children}
        </div>
      )}
    </section>
  );
}

/** A block inside a panel: a quieter 11.5px heading over a soft rule, no card of its own. */
export function PanelGroup({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  const uid = useId();
  return (
    <section aria-labelledby={uid} className={cn("border-t border-border/60 pt-2 first:border-t-0 first:pt-0", className)}>
      <h3 id={uid} className="pb-1 text-[11.5px] font-bold tracking-[.02em] text-ink2">
        {title}
      </h3>
      <div className="flex min-w-0 flex-col">{children}</div>
    </section>
  );
}
