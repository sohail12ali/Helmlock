// A mocked fetch that answers /api/v1 from the typed fixtures, using the contract's envelope.
import { vi } from "vitest";
import * as fx from "./fixtures";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const ok = (data: unknown) => json({ ok: true, data });
const notFound = (message: string) => json({ ok: false, error: { rule: "not-found", message } }, 404);

export function route(url: string): Response {
  const u = new URL(url, "http://localhost");
  const p = u.pathname.replace(/^\/api\/v1/, "");
  if (p === "/workspace") return ok(fx.workspace);
  if (p === "/overview") return ok(fx.overview);
  if (p === "/board") return ok(fx.board);
  if (p === "/tickets") return ok(fx.cards);
  if (p === "/runs") return ok(fx.runs);
  if (p === "/activity") return ok(fx.activity);
  if (p === "/worklog") return ok(fx.worklog);
  if (p === "/skills") return ok(fx.skills);
  if (p === "/search") return ok(fx.search);
  // Onboarding v2: /setup itself stays 404 here (no step list, so the console never opens /welcome by itself in tests).
  if (p === "/setup/detect") return ok(fx.setupDetect);
  if (p === "/setup/upkeep") return ok({ repaired: [], failures: [] });
  const art = /^\/tickets\/([^/]+)\/artifacts\/([^/]+)$/.exec(p);
  if (art) {
    const c = fx.artifactContent(decodeURIComponent(art[1]!), decodeURIComponent(art[2]!));
    return c ? ok(c) : notFound("unknown artifact");
  }
  const tk = /^\/tickets\/([^/]+)$/.exec(p);
  if (tk) {
    const d = fx.details[decodeURIComponent(tk[1]!)];
    return d ? ok(d) : notFound(`unknown ticket ${tk[1]}`);
  }
  return notFound(`no route ${p}`);
}

export function installFetch() {
  const spy = vi.fn(async (input: RequestInfo | URL) => route(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
  vi.stubGlobal("fetch", spy);
  return spy;
}
