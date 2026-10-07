import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "./media";
import { readPref, writePref } from "./prefs";

export type ThemePref = "system" | "light" | "dark";
const PREFS = ["system", "light", "dark"] as const;

interface ThemeCtx {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readPref("theme", "system", PREFS));
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo<ThemeCtx>(() => {
    const setPref = (p: ThemePref) => {
      writePref("theme", p);
      setPrefState(p);
    };
    return { pref, resolved, setPref, toggle: () => setPref(resolved === "dark" ? "light" : "dark") };
  }, [pref, resolved]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}
