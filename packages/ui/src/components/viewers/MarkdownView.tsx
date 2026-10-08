import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** Markdown viewer (F148). Raw HTML is never rendered; links open outside the console. Lazy-loaded. */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <article className="md max-w-[100ch]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}
