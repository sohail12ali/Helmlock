// Minimal path globs: "**" spans directories, "*" and "?" stay inside one segment. Anchored at the root.

export function globToRegExp(glob: string): RegExp {
  let re = "";
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*") {
      if (g[i + 1] === "*") {
        const slash = g[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  const p = path.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g).test(p));
}

/** The literal directory before the first wildcard ("artifacts/**\/ticket.toml" -> "artifacts"). */
export function globBase(glob: string): string {
  const parts = glob.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const p of parts.slice(0, -1)) {
    if (/[*?[]/.test(p)) break;
    out.push(p);
  }
  return out.join("/");
}
