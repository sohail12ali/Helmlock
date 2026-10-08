// One markdown pipeline for the static pages (F32, Blueprint 24): remark-parse + remark-gfm -> remark-rehype ->
// rehype-sanitize (GitHub schema) -> rehype-stringify. The React UI mirrors REMARK_PLUGINS and SANITIZE_SCHEMA
// (react-markdown remarkPlugins / rehypePlugins) so a spec reads the same live and on disk.
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/** Remark plugins shared with the UI (react-markdown `remarkPlugins`). */
export const REMARK_PLUGINS = [remarkGfm] as const;
/** Sanitize schema shared with the UI (react-markdown `rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}`). */
export const SANITIZE_SCHEMA = defaultSchema;

/** Minimal hast shape; enough for the two small transforms below. */
interface HNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

const walk = (node: HNode, fn: (n: HNode) => void): void => {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
};
const textOf = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));
const classes = (n: HNode): string[] => {
  const c = n.properties?.className;
  return Array.isArray(c) ? c.map(String) : typeof c === "string" ? c.split(/\s+/) : [];
};

/**
 * ```mermaid fences become <pre class="mermaid">. Runs after sanitize, so the class is ours, not the author's.
 * TODO(F35/F50): vendor mermaid.min.js beside the site and include it only on pages that hold a diagram;
 * until then the diagram source shows as a plain block.
 */
function rehypeMermaid() {
  return (tree: HNode) => {
    walk(tree, (n) => {
      if (n.type !== "element" || n.tagName !== "pre" || n.children?.length !== 1) return;
      const code = n.children[0]!;
      if (code.tagName !== "code" || !classes(code).includes("language-mermaid")) return;
      n.properties = { className: ["mermaid"] };
      n.children = [{ type: "text", value: textOf(code) }];
    });
  };
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Relative href/src are rebased so links written next to the markdown file still work from the generated page. */
function rehypeRebase(opts: { base?: string }) {
  return (tree: HNode) => {
    const base = opts.base;
    if (!base) return;
    walk(tree, (n) => {
      if (n.type !== "element" || !n.properties) return;
      for (const key of ["href", "src"]) {
        const v = n.properties[key];
        if (typeof v !== "string" || !v || v.startsWith("#") || v.startsWith("/") || SCHEME.test(v)) continue;
        n.properties[key] = base + v;
      }
    });
  };
}

export interface MarkdownOptions {
  /** Prefix for relative links and images, e.g. "../../artifacts/T-014-sa/". */
  base?: string;
}

/** Markdown to sanitised HTML. Raw HTML in the source is dropped (remark-rehype without allowDangerousHtml). */
export function renderMarkdown(md: string, opts: MarkdownOptions = {}): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeMermaid as never)
    .use(rehypeRebase as never, opts)
    .use(rehypeStringify)
    .processSync(md);
  return String(file);
}
