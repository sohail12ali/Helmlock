import { createContext, useContext } from "react";

export interface ShellCtx {
  narrow: boolean;
  phone: boolean;
  openPalette: () => void;
  openHelp: () => void;
}

export const ShellContext = createContext<ShellCtx>({ narrow: false, phone: false, openPalette: () => {}, openHelp: () => {} });

export const useShell = () => useContext(ShellContext);
