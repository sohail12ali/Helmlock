import type { ArtifactContent } from "@helmlock/core/contracts";
import { lazy, Suspense } from "react";
import { Loading } from "@/components/common";

// Viewers are lazy so markdown and friends stay out of the initial bundle (budget: < 250 KB gzip).
const MarkdownView = lazy(() => import("./MarkdownView"));
const TomlView = lazy(() => import("./TomlView"));
const JsonlView = lazy(() => import("./JsonlView"));
const HtmlView = lazy(() => import("./HtmlView"));

/** One viewer per kind (F148): Markdown, TOML as a table, JSONL as a timeline, HTML in a sandboxed iframe. */
export function ArtifactViewer({ content }: { content: ArtifactContent }) {
  const { ref, text } = content;
  return (
    <Suspense fallback={<Loading label="Opening file" />}>
      {ref.kind === "md" ? (
        <MarkdownView text={text} />
      ) : ref.kind === "toml" ? (
        <TomlView text={text} />
      ) : ref.kind === "jsonl" ? (
        <JsonlView text={text} />
      ) : ref.kind === "html" ? (
        <HtmlView text={text} title={ref.title} />
      ) : (
        <pre className="max-w-full overflow-x-auto rounded-md border bg-sunk p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      )}
    </Suspense>
  );
}
