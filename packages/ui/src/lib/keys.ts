// Keyboard map (F68): j/k move, Enter opens, / search, ? help, Ctrl+K palette, g then a letter to jump.
import { useEffect, useRef, useState } from "react";

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"]');
}

export const GO_KEYS: Record<string, { path: string; label: string }> = {
  o: { path: "/", label: "Overview" },
  i: { path: "/inbox", label: "Inbox" },
  t: { path: "/tickets", label: "Tickets" },
  d: { path: "/todos", label: "Todos" },
  w: { path: "/work", label: "Work" },
  a: { path: "/agents", label: "Agents and chat" },
  k: { path: "/knowledge", label: "Knowledge" },
  p: { path: "/people", label: "People" },
  s: { path: "/settings", label: "Settings" },
};

export interface GlobalKeyHandlers {
  onPalette: () => void;
  onHelp: () => void;
  onSearch: () => void;
  onGo: (path: string) => void;
}

export function useGlobalKeys(h: GlobalKeyHandlers): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current.onPalette();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || dialogOpen()) return;
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const go = GO_KEYS[e.key];
        if (go) {
          e.preventDefault();
          ref.current.onGo(go.path);
        }
        return;
      }
      if (e.key === "g") {
        gAt = Date.now();
      } else if (e.key === "/") {
        e.preventDefault();
        ref.current.onSearch();
      } else if (e.key === "?") {
        e.preventDefault();
        ref.current.onHelp();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/** j/k selection over a list, Enter opens. Returns the selected index (-1 = none). */
export function useListNav(count: number, onOpen: (index: number) => void, enabled = true): [number, (i: number) => void] {
  const [index, setIndex] = useState(-1);
  const ref = useRef({ count, onOpen, index });
  ref.current = { count, onOpen, index };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || dialogOpen()) return;
      const { count: n, index: i } = ref.current;
      if (n === 0) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setIndex(Math.min(n - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex(Math.max(0, i - 1));
      } else if (e.key === "Enter" && i >= 0) {
        // Let focused links and buttons handle their own Enter.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "A" || t.tagName === "BUTTON")) return;
        e.preventDefault();
        ref.current.onOpen(i);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => {
    if (index >= count) setIndex(count - 1);
  }, [count, index]);

  useEffect(() => {
    if (index < 0) return;
    document.querySelector(`[data-nav-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return [index, setIndex];
}
