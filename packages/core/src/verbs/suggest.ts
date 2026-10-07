// "Did you mean" for verbs and ids (F56).

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

/**
 * Closest candidates, best first. A candidate qualifies when its edit distance is within about a third
 * of the longer string, or when one string starts with the other (`tick` -> `ticket list`).
 */
export function didYouMean(input: string, candidates: Iterable<string>, max = 3): string[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];
  const scored: { c: string; d: number }[] = [];
  for (const c of new Set(candidates)) {
    const lc = c.toLowerCase();
    const d = levenshtein(q, lc);
    const limit = Math.max(2, Math.floor(Math.max(q.length, lc.length) / 3));
    if (d <= limit) scored.push({ c, d });
    else if (lc.startsWith(`${q} `) || (q.length >= 3 && lc.startsWith(q))) scored.push({ c, d: limit + 1 });
  }
  return scored
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, max)
    .map((s) => s.c);
}
