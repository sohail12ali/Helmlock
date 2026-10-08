/** Generated HTML in a fully sandboxed iframe (F148): no scripts, no same-origin access, no forms. */
export default function HtmlView({ text, title }: { text: string; title: string }) {
  return <iframe title={title} sandbox="" srcDoc={text} referrerPolicy="no-referrer" className="h-[75vh] w-full rounded-md border bg-white" />;
}
