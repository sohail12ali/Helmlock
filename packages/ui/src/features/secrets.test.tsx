// Milestone 7: the Telegram step saves the bot token on this machine through `secret set`, never showing it again.
import type { SettingsView, SetupStatus } from "@helmlock/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });
const TOKEN = "123456:AAH-secret-token-value";

afterEach(() => vi.unstubAllGlobals());

function server() {
  let saved = false;
  const setup = (): SetupStatus => ({
    steps: [
      { id: "you", label: "You", done: true, detail: "Sam Abbott (sam)" },
      { id: "engine", label: "Engines", done: true, detail: "Claude Code" },
      saved
        ? { id: "phone", label: "Phone", optional: true, done: true, detail: "token in HL_TELEGRAM_TOKEN (this machine's .env); 1 allowed id" }
        : { id: "phone", label: "Phone", optional: true, done: false, detail: "optional: paste the token below or set HL_TELEGRAM_TOKEN" },
      { id: "first-task", label: "First task", done: false, detail: "no tickets yet" },
    ],
  });
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    if (u.pathname === "/api/v1/setup") return ok(setup());
    if (u.pathname === "/api/v1/models") return ok({ providers: [], models: [] });
    if (u.pathname === "/api/v1/settings") return ok({ sections: [] } satisfies SettingsView);
    if (u.pathname === "/api/v1/verbs/secret/status" && init?.method === "POST")
      return ok([{ name: "HL_TELEGRAM_TOKEN", source: saved ? ".env" : "missing", used_by: "telegram.token_env" }]);
    if (u.pathname === "/api/v1/verbs/secret/set" && init?.method === "POST") {
      saved = true;
      return json({
        ok: true,
        data: { name: "HL_TELEGRAM_TOKEN", file: ".env", added: true },
        text: "HL_TELEGRAM_TOKEN saved in this machine's .env (gitignored).",
      });
    }
    if (u.pathname.startsWith("/api/v1/verbs/") && init?.method === "POST") return json({ ok: true, data: { changed: true } });
    return route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const posts = (spy: ReturnType<typeof server>, path: string) =>
  spy.mock.calls
    .filter(([input, init]) => init?.method === "POST" && String(input).split("?")[0] === `/api/v1${path}`)
    .map(([, init]) => ({ body: JSON.parse(String(init!.body)) as Record<string, unknown>, headers: init!.headers as Record<string, string> }));

describe("setup: telegram token", () => {
  it("saves the token with secret set, clears the field, shows the source and flips the step to done", async () => {
    const spy = server();
    localStorage.setItem("hl.welcome.draft", JSON.stringify({ step: "phone" }));
    renderApp("/setup"); // the old address redirects to /welcome
    const step = await screen.findByRole("region", { name: "Step: Phone" });
    expect(within(step).getByText("Saved only on this machine,", { exact: false })).toBeInTheDocument();
    await within(step).findByText("missing");

    const field = within(step).getByLabelText("Bot token") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: TOKEN } });
    fireEvent.click(within(step).getByRole("button", { name: "Save on this machine" }));

    await waitFor(() => expect(posts(spy, "/verbs/secret/set")).toHaveLength(1));
    const call = posts(spy, "/verbs/secret/set")[0]!;
    expect(call.body).toEqual({ input: { name: "HL_TELEGRAM_TOKEN", value: TOKEN } });
    expect(call.headers["X-Helmlock-Request"]).toBe("1");

    await waitFor(() => expect(field.value).toBe(""));
    await within(step).findByText("this machine's .env");
    expect(await screen.findByText(/HL_TELEGRAM_TOKEN saved in this machine's \.env/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
    // The setup query was refetched and the phone step is done now.
    await waitFor(() => expect(screen.getByRole("button", { name: /Phone/ })).toHaveAccessibleName(/done/i));
  });

  it("the advanced variable field says where a pasted token belongs", async () => {
    server();
    localStorage.setItem("hl.welcome.draft", JSON.stringify({ step: "phone" }));
    renderApp("/setup"); // the old address redirects to /welcome
    const step = await screen.findByRole("region", { name: "Step: Phone" });
    fireEvent.click(within(step).getByRole("button", { name: /token variable name/ }));
    fireEvent.change(within(step).getByLabelText(/Bot token variable/), { target: { value: TOKEN } });
    fireEvent.click(within(step).getByRole("button", { name: "Save variable" }));
    expect(await within(step).findByRole("alert")).toHaveTextContent(/paste it into Bot token above/);
  });
});
