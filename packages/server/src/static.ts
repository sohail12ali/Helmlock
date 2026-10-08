// Serves the built UI (packages/ui/dist) with an SPA fallback, or a short page saying how to build it.
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

export const DEFAULT_UI_DIR = resolve(import.meta.dirname, "..", "..", "ui", "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export const UI_MISSING_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Helmlock console</title>
<style>body{font:15px system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}code{background:#eee;padding:.1rem .3rem;border-radius:4px}</style>
</head><body><h1>UI not built</h1>
<p>The console API is running. To see the console, build the UI and reload this page:</p>
<p><code>pnpm --filter @helmlock/ui build</code></p>
<p>The API is at <a href="/api/v1/workspace">/api/v1/workspace</a>.</p>
</body></html>
`;

/** Response for a non-API GET: a file from dist, else index.html (client routes), else the "not built" page. */
export async function serveUi(uiDir: string, pathname: string): Promise<Response> {
  const index = join(uiDir, "index.html");
  if (!existsSync(index)) return new Response(UI_MISSING_HTML, { status: 200, headers: { "content-type": TYPES[".html"]! } });
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return new Response("bad path", { status: 400 });
  }
  const abs = resolve(uiDir, `.${rel.startsWith("/") ? rel : `/${rel}`}`);
  if (abs.startsWith(uiDir + sep) && !rel.includes("\0")) {
    const s = await stat(abs).catch(() => undefined);
    if (s?.isFile()) {
      const type = TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream";
      const immutable = rel.startsWith("/assets/");
      return new Response(await readFile(abs), {
        headers: { "content-type": type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    // A missing file with an extension is a real 404, not a client route.
    // Client routes such as /t/T-001-sa/T-001-sa-spec.md carry file names, so only /assets/ and top-level files 404.
    if (extname(rel) && (rel.startsWith("/assets/") || rel.lastIndexOf("/") === 0))
      return new Response("not found", { status: 404, headers: { "content-type": TYPES[".txt"]! } });
  }
  return new Response(await readFile(index), { headers: { "content-type": TYPES[".html"]!, "cache-control": "no-cache" } });
}
