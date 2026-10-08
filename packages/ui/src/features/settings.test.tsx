// The Settings page in control-center style: jump bar, folding panels that remember, auto-save, reset to default,
// chips, the .env footer (names only) and the "Loaded on the server" diagnostics.
import type { CrewView, MachineEnvView, ServerPluginsView, SettingsView, SetupStatus } from "@helmlock/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANELS_KEY } from "@/pages/Settings";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });

afterEach(() => vi.unstubAllGlobals());

const view: SettingsView = {
  sections: [
    {
      id: "workspace",
      label: "Workspace",
      plugins: [
        {
          plugin: "work-log",
          label: "Work log",
          fields: [{ key: "day_hours", type: "number", label: "Working day (hours)", default: 8, scope: "workspace", applies: "restart" }],
          values: { day_hours: { value: 8, source: "default" } },
        },
      ],
    },
    {
      id: "models",
      label: "Models",
      plugins: [
        {
          plugin: "providers",
          label: "Providers",
          fields: [
            { key: "default_model", type: "string", label: "Default model", scope: "workspace", applies: "live" },
            { key: "assistant_model", type: "string", label: "Assistant model", scope: "workspace", applies: "live" },
          ],
          values: { default_model: { value: "or/a/one", source: "workspace.toml" }, assistant_model: { value: null, source: "default" } },
        },
      ],
    },
    {
      id: "agents",
      label: "Agents",
      plugins: [
        {
          plugin: "runtimes",
          label: "Runtimes",
          fields: [
            { key: "silence_sec", type: "number", label: "Silence timeout (seconds)", default: 1800, scope: "workspace", applies: "restart" },
            {
              key: "default_runtime",
              type: "select",
              label: "Default runtime",
              options: ["claude-code", "cursor"],
              default: "claude-code",
              scope: "workspace",
            },
          ],
          values: { silence_sec: { value: 900, source: "workspace.toml" }, default_runtime: { value: "claude-code", source: "default" } },
        },
      ],
    },
    { id: "permissions", label: "Permissions", plugins: [] },
    {
      id: "telegram",
      label: "Telegram",
      plugins: [
        {
          plugin: "telegram",
          label: "Telegram",
          fields: [
            { key: "token_env", type: "secret-env", label: "Bot token variable", default: "HL_TELEGRAM_TOKEN", scope: "local", applies: "live" },
            { key: "allowed_user_ids", type: "list", label: "Allowed Telegram user ids", scope: "local", applies: "live" },
          ],
          values: { token_env: { value: "HL_TELEGRAM_TOKEN", source: "default" }, allowed_user_ids: { value: [], source: "default" } },
        },
      ],
    },
  ],
};

const SECRET = "987654:AAH-should-never-show";
const plugins: ServerPluginsView = {
  plugins: [
    { id: "work-log", use: "work-log", version: "0.1.0", provides: ["worklog"], status: "ok" },
    { id: "crew", use: "crew", version: "0.1.0", provides: ["crew"], status: "pending", waiting_for: ["runManager"] },
  ],
};
const env: MachineEnvView = { file: "C:/kc/.env", exists: true, names: ["HL_TELEGRAM_TOKEN", "OPENROUTER_API_KEY"] };
const crew = {
  roles: [],
  engines: [
    {
      id: "claude-code",
      label: "Claude Code",
      capabilities: { resume: true, steer: false, approve: true, models: false },
      test: { ok: true, checks: [{ level: "info", message: "claude 2.1.0" }] },
    },
    {
      id: "cursor",
      label: "Cursor",
      capabilities: { resume: false, steer: false, approve: false, models: false },
      test: { ok: false, checks: [{ level: "error", message: "cursor-agent not on PATH" }] },
    },
  ],
  live: 0,
  max_live: 2,
  needs_you: [],
} as unknown as CrewView;
const setup: SetupStatus = { steps: [{ id: "telegram", label: "Telegram", done: false, detail: "allow at least one Telegram user id" }] };

type Post = { path: string; body: { input?: Record<string, unknown> } };

function server(opts: { reply?: (p: Post) => unknown } = {}) {
  const posts: Post[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const p = new URL(href, "http://localhost").pathname.replace(/^\/api\/v1/, "");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      if (p === "/verbs/secret/status") return ok([{ name: "HL_TELEGRAM_TOKEN", source: ".env", used_by: "telegram.token_env" }]);
      posts.push({ path: p, body });
      if (p === "/engines/test") return ok(crew.engines.map((e) => ({ ...e, test: { ok: true, checks: [{ level: "info", message: "found now" }] } })));
      return json(opts.reply?.({ path: p, body }) ?? { ok: true, code: 0, data: {}, text: "set" });
    }
    if (p === "/settings") return ok(view);
    if (p === "/server/plugins") return ok(plugins);
    if (p === "/settings/env") return ok(env);
    if (p === "/crew") return ok(crew);
    if (p === "/setup") return ok(setup);
    if (p === "/models") return ok({ providers: [], models: [{ id: "or/a/one" }, { id: "or/b/two" }] });
    return route(href);
  });
  vi.stubGlobal("fetch", spy);
  return posts;
}

const jumpBar = () => screen.getByRole("navigation", { name: "Settings sections" });
const panel = (name: string) => screen.getByRole("region", { name });

describe("Settings: layout", () => {
  it("the jump bar lists the rendered panels in order; a click opens the panel and scrolls to it", async () => {
    server();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    renderApp("/settings");
    await screen.findByRole("region", { name: "Appearance" });
    await waitFor(() => expect(within(jumpBar()).getAllByRole("button").length).toBeGreaterThan(8));
    const names = within(jumpBar())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "Appearance",
      "Models",
      "Agents",
      "Assistant",
      "Permissions",
      "Telegram",
      "Work log",
      "This machine",
      "Workspace",
      "Loaded on the server",
      "Collapse all",
      "Expand all",
    ]);
    // Appearance is open by default; the rest are folded.
    expect(panel("Appearance")).toHaveAttribute("data-open", "true");
    expect(panel("Telegram")).toHaveAttribute("data-open", "false");
    fireEvent.click(within(jumpBar()).getByRole("button", { name: "Telegram" }));
    expect(panel("Telegram")).toHaveAttribute("data-open", "true");
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts.at(-1)).toBe(panel("Telegram"));
  });

  it("remembers open and closed panels, and Collapse all / Expand all reach every panel", async () => {
    server();
    const first = renderApp("/settings");
    await screen.findByRole("region", { name: "Appearance" });
    fireEvent.click(within(panel("Appearance")).getByRole("button", { name: "Collapse Appearance" }));
    fireEvent.click(within(panel("Workspace")).getByRole("button", { name: "Expand Workspace" }));
    expect(JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}")).toEqual({ "settings-appearance": false, "settings-workspace": true });
    first.unmount();

    renderApp("/settings");
    await screen.findByRole("region", { name: "Appearance" });
    expect(panel("Appearance")).toHaveAttribute("data-open", "false");
    expect(panel("Workspace")).toHaveAttribute("data-open", "true");

    fireEvent.click(within(jumpBar()).getByRole("button", { name: "Expand all" }));
    for (const r of screen.getAllByRole("region").filter((e) => e.hasAttribute("data-panel"))) expect(r).toHaveAttribute("data-open", "true");
    fireEvent.click(within(jumpBar()).getByRole("button", { name: "Collapse all" }));
    for (const r of screen.getAllByRole("region").filter((e) => e.hasAttribute("data-panel"))) expect(r).toHaveAttribute("data-open", "false");
  });

  it("a panel named by the URL hash opens; the ⓘ button shows where its settings are stored", async () => {
    server();
    renderApp("/settings#settings-agents");
    const agents = await screen.findByRole("region", { name: "Agents" });
    expect(agents).toHaveAttribute("data-open", "true");
    fireEvent.click(within(agents).getByRole("button", { name: "What Agents does" }));
    expect(agents).toHaveTextContent(/binary paths are per machine in workspace\.local\.toml/);
  });
});

describe("Settings: rows", () => {
  it("auto-saves a number once on change (blur), not per keystroke, and shows Saved", async () => {
    const posts = server();
    renderApp("/settings#settings-agents");
    const input = await screen.findByLabelText("Silence timeout (seconds)");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.change(input, { target: { value: "600" } });
    expect(posts).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/verbs/config/set", body: { input: { plugin: "runtimes", key: "silence_sec", value: 600 } } });
    const row = input.closest("[data-setting]") as HTMLElement;
    expect(await within(row).findByText("Saved")).toBeInTheDocument();
  });

  it("a select saves on change", async () => {
    const posts = server();
    renderApp("/settings#settings-agents");
    fireEvent.change(await screen.findByLabelText("Default runtime"), { target: { value: "cursor" } });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.input).toEqual({ plugin: "runtimes", key: "default_runtime", value: "cursor" });
  });

  it("shows changed, scope and applies chips, and Reset to default sends config set with unset", async () => {
    const posts = server();
    renderApp("/settings#settings-agents");
    const row = (await screen.findByLabelText("Silence timeout (seconds)")).closest("[data-setting]") as HTMLElement;
    expect(within(row).getByText("changed")).toHaveAttribute("title", "Differs from the plugin default: 1800");
    expect(within(row).getByText("shared")).toBeInTheDocument();
    expect(within(row).getByText("restart needed")).toBeInTheDocument();
    const other = screen.getByLabelText("Default runtime").closest("[data-setting]") as HTMLElement;
    expect(within(other).queryByText("changed")).not.toBeInTheDocument();
    expect(within(other).getByText("live")).toBeInTheDocument();
    expect(within(other).queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Reset Silence timeout (seconds) to default" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.input).toEqual({ plugin: "runtimes", key: "silence_sec", unset: true });
  });

  it("a server refusal is shown on the row and the settings reload", async () => {
    server({ reply: () => ({ ok: false, code: 1, error: { rule: "config-bad-value", message: "runtimes.silence_sec: must be at least 1" } }) });
    renderApp("/settings#settings-agents");
    const input = await screen.findByLabelText("Silence timeout (seconds)");
    const reads = () =>
      (fetch as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls.filter(
        ([u]) => String(u).startsWith("/api/v1/settings?") || String(u) === "/api/v1/settings",
      ).length;
    const before = reads();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    const row = input.closest("[data-setting]") as HTMLElement;
    expect(await within(row).findByText(/must be at least 1/)).toBeInTheDocument();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    expect(input).toHaveValue(900);
  });

  it("model settings pick from the configured models", async () => {
    const posts = server();
    renderApp("/settings#settings-assistant");
    const sel = await screen.findByLabelText("Assistant model");
    await waitFor(() =>
      expect(
        within(sel)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["(the default model)", "or/a/one", "or/b/two"]),
    );
    fireEvent.change(sel, { target: { value: "or/b/two" } });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.input).toEqual({ plugin: "providers", key: "assistant_model", value: "or/b/two" });
  });

  it("Telegram: not-ready chip, fail-closed when nobody is allowed, the token pasted through MachineSecret", async () => {
    server();
    renderApp("/settings#settings-telegram");
    const tg = await screen.findByRole("region", { name: "Telegram" });
    expect(await within(tg).findByText("not ready")).toBeInTheDocument();
    const ids = within(tg).getByLabelText("Allowed Telegram user ids").closest("[data-setting]") as HTMLElement;
    expect(within(ids).getByText("fail-closed")).toBeInTheDocument();
    expect(within(ids).getByText("this machine")).toBeInTheDocument();
    expect(within(tg).getByLabelText("Bot token")).toHaveAttribute("type", "password");
  });
});

describe("Settings: machine and server", () => {
  it("the .env footer shows the path and the names it defines, never values", async () => {
    server();
    renderApp("/settings#settings-machine");
    const footer = await screen.findByTestId("env-footer");
    expect(await within(footer).findByText("C:/kc/.env")).toBeInTheDocument();
    expect(within(footer).getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(await within(footer).findByText("telegram.token_env")).toBeInTheDocument();
    expect(footer.textContent).not.toContain("=");
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("Loaded on the server lists plugins with version, provides and status", async () => {
    server();
    renderApp("/settings#settings-server");
    const table = await screen.findByRole("table", { name: "Plugins loaded on the server" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("work-log");
    expect(rows[1]).toHaveTextContent("0.1.0");
    expect(rows[1]).toHaveTextContent("worklog");
    expect(within(rows[1]!).getByText("ok")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("pending")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("waits for runManager");
  });

  it("Agents lists the engines found and not found; Test engines runs them again", async () => {
    const posts = server();
    renderApp("/settings#settings-agents");
    const agents = await screen.findByRole("region", { name: "Agents" });
    const cursor = (await within(agents).findByText("not found")).closest("[data-engine]") as HTMLElement;
    expect(cursor).toHaveAttribute("data-engine", "cursor");
    expect(cursor).toHaveTextContent("cursor-agent not on PATH");
    expect(within(agents.querySelector('[data-engine="claude-code"]') as HTMLElement).getByText("found")).toBeInTheDocument();
    expect(within(agents).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(agents).getByRole("button", { name: "Test engines" }));
    await waitFor(() => expect(posts.map((p) => p.path)).toContain("/engines/test"));
    await waitFor(() => expect(within(agents.querySelector('[data-engine="cursor"]') as HTMLElement).getByText("found")).toBeInTheDocument());
  });

  it("tolerates a server without the diagnostics routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const href = String(input);
        if (href.startsWith("/api/v1/settings") && !href.startsWith("/api/v1/settings/env")) return ok(view);
        return route(href);
      }),
    );
    renderApp("/settings#settings-server");
    expect(await screen.findByText(/does not list its plugins/)).toBeInTheDocument();
  });
});
