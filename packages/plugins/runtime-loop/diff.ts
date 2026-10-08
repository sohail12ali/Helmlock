// A small line diff for `diff` events: the changed region between the common head and tail, with 3 context lines.
// Enough for one edit or one file write; counts are exact for a single changed region and an upper bound otherwise.

export const PATCH_MAX = 4_000;

export function lineDiff(file: string, before: string, after: string): { added: number; removed: number; patch: string } {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  if (!removed.length && !added.length) return { added: 0, removed: 0, patch: "" };
  const ctx = 3;
  const from = Math.max(0, head - ctx);
  const pre = a.slice(from, head);
  const post = a.slice(a.length - tail, Math.min(a.length, a.length - tail + ctx));
  const lines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${from + 1},${pre.length + removed.length + post.length} +${from + 1},${pre.length + added.length + post.length} @@`,
    ...pre.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...post.map((l) => ` ${l}`),
  ];
  let patch = lines.join("\n");
  if (patch.length > PATCH_MAX) patch = `${patch.slice(0, PATCH_MAX)}\n[patch cut]`;
  return { added: added.length, removed: removed.length, patch };
}
