// The closure digest (F125): a fixed shape of five sections, about 400 words, `(none)` for an empty section.
// The close skill drafts it as artifacts/<T>/<T>-digest.md (older drafts: <T>-closure.md); this file checks it.

export const DIGEST_SECTIONS = ["Outcome", "Decisions", "Key files and links", "Caveats", "Follow-ups"] as const;
/** About 400 words is the target; above this the digest is refused. */
export const MAX_DIGEST_WORDS = 450;

export const digestNames = (id: string) => [`${id}-digest.md`, `${id}-closure.md`];

export interface DigestProblem {
  rule: string;
  message: string;
}
export interface DigestCheck {
  ok: boolean;
  words: number;
  problems: DigestProblem[];
  frontmatter: Record<string, string>;
  title: string | undefined;
}

/** Simple `key: value` frontmatter (generated and template files only use that form). */
export function splitFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (!m) return { fm: {}, body: t };
  const fm: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1] as string] = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body: t.slice(m[0].length) };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function wordCount(body: string): number {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s.*$/gm, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
  return prose.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Validate shape and size. Template placeholders ({T}, {X}) and missing or empty sections are refused. */
export function checkDigest(text: string): DigestCheck {
  const { fm, body } = splitFrontmatter(text);
  const problems: DigestProblem[] = [];
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const sections = new Map<string, string>();
  let current: string | undefined;
  for (const line of body.split("\n")) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = norm(h[1] as string);
      sections.set(current, "");
      continue;
    }
    if (current !== undefined) sections.set(current, `${sections.get(current)}${line}\n`);
  }
  for (const name of DIGEST_SECTIONS) {
    const content = sections.get(norm(name));
    if (content === undefined) problems.push({ rule: "digest-section-missing", message: `section "## ${name}" is missing` });
    else if (!content.replace(/<!--[\s\S]*?-->/g, "").trim())
      problems.push({ rule: "digest-section-empty", message: `section "## ${name}" is empty; write (none) when there is nothing` });
  }
  const placeholder = /\{(T|X|Y|YYYY-MM-DD|reason|project)\}/.exec(body);
  if (placeholder) problems.push({ rule: "digest-placeholder", message: `template placeholder ${placeholder[0]} is still in the digest` });
  const words = wordCount(body);
  if (words > MAX_DIGEST_WORDS)
    problems.push({ rule: "digest-too-long", message: `${words} words; a digest is about 400 words (at most ${MAX_DIGEST_WORDS})` });
  return { ok: problems.length === 0, words, problems, frontmatter: fm, title };
}
