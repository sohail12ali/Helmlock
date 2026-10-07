// Layout prefs and theme live in localStorage only (F83). Every access is guarded: storage can be blocked.
const PREFIX = "hl.";

export function readPref<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v === null) return fallback;
    if (allowed && !allowed.includes(v as T)) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage blocked: the pref lasts for this page only */
  }
}

/** Storage adapter for react-resizable-panels' useDefaultLayout. */
export const layoutStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    writePref(key, value);
  },
};
