// Milestone 7: several models at once. Settings > Models lists providers with their models; make default, remove
// (confirmed in the page), add more models to a saved provider and remove a provider. Fetch is mocked.
import type { ModelProbe, ModelsView, SettingsView } from "@helmlock/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { route } from "@/test/server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });

const caps = { tool_calls: true, vision: false, streaming: true };
const view: ModelsView = {
  providers: [
    { id: "lms", label: "LM Studio", base_url: "http://192.168.1.14:1234/v1", preset: "lmstudio", compat: {} },
    { id: "or", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_env: "OPENROUTER_API_KEY", preset: "openrouter", compat: {} },
  ],
  models: [
    { id: "lms/spark-x2.5-4b", provider: "lms", label: "spark-x2.5-4b", capabilities: caps },
    { id: "or/a/one", provider: "or", label: "a/one", capabilities: caps },
    { id: "or/b/two", provider: "or", label: "b/two", capabilities: { ...caps, vision: true } },
  ],
  default: "or/a/one",
};
const orList: ModelProbe = {
  provider: "draft",
  reachable: true,
  models: ["a/one", "b/two", "c/three"],
  chat: false,
  streaming: false,
  tool_calls: false,
  model_info: [{ id: "a/one" }, { id: "b/two" }, { id: "c/three", context_window: 131072, tool_calls: true }],
};

function server() {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, "http://localhost");
    if (u.pathname === "/api/v1/settings") return ok({ sections: [{ id: "models", label: "Models", plugins: [] }] } satisfies SettingsView);
    if (u.pathname === "/api/v1/models") return ok(view);
    if (u.pathname === "/api/v1/models/try" && init?.method === "POST") return ok(orList);
    if (u.pathname.startsWith("/api/v1/verbs/") && init?.method === "POST") return json({ ok: true, data: { changed: true } });
    return route(href);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const posts = (spy: ReturnType<typeof server>, path: string) =>
  spy.mock.calls.filter(([input, init]) => init?.method === "POST" && String(input) === `/api/v1${path}`).map(([, init]) => JSON.parse(String(init!.body)));

afterEach(() => vi.unstubAllGlobals());

describe("Settings > Models: several models", () => {
  it("lists each provider with its models and marks the default; the star makes another one the default", async () => {
    const spy = server();
    renderApp("/settings#settings-models");
    const list = await screen.findByTestId("providers-list");
    const lms = within(list).getByRole("region", { name: "Provider lms" });
    const or = within(list).getByRole("region", { name: "Provider or" });
    expect(lms).toHaveTextContent("lms/spark-x2.5-4b");
    expect(or).toHaveTextContent("or/a/one");
    expect(or).toHaveTextContent("or/b/two");
    expect(or).toHaveTextContent("key OPENROUTER_API_KEY");
    expect(within(or).getByRole("button", { name: "or/a/one is the default model" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(or).getByRole("button", { name: "Make or/b/two the default model" }));
    await waitFor(() => expect(posts(spy, "/verbs/model/default")).toEqual([{ input: { id: "or/b/two" } }]));
  });

  it("removing the default model asks for the new default in the page", async () => {
    const spy = server();
    renderApp("/settings#settings-models");
    const or = await screen.findByRole("region", { name: "Provider or" });
    fireEvent.click(within(or).getByRole("button", { name: "Remove or/a/one" }));
    const confirm = within(or).getByRole("group", { name: "Confirm removing or/a/one" });
    expect(confirm).toHaveTextContent("It is the default model");
    fireEvent.change(within(confirm).getByLabelText(/New default/), { target: { value: "or/b/two" } });
    expect(posts(spy, "/verbs/model/remove")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(posts(spy, "/verbs/model/remove")).toEqual([{ input: { id: "or/a/one", default: "or/b/two" } }]));
    await waitFor(() => expect(within(or).queryByRole("group", { name: "Confirm removing or/a/one" })).not.toBeInTheDocument());

    // A model that is not the default: no new default asked; Cancel sends nothing.
    fireEvent.click(within(or).getByRole("button", { name: "Remove or/b/two" }));
    const c2 = within(or).getByRole("group", { name: "Confirm removing or/b/two" });
    expect(c2).not.toHaveTextContent("default");
    fireEvent.click(within(c2).getByRole("button", { name: "Cancel" }));
    expect(posts(spy, "/verbs/model/remove")).toHaveLength(1);
  });

  it("removing the provider that holds the default says where the default goes and sends force", async () => {
    const spy = server();
    renderApp("/settings#settings-models");
    const or = await screen.findByRole("region", { name: "Provider or" });
    fireEvent.click(within(or).getByRole("button", { name: "Remove provider or" }));
    const confirm = within(or).getByRole("group", { name: "Confirm removing provider or" });
    expect(confirm).toHaveTextContent("and its 2 models");
    expect(confirm).toHaveTextContent("The default moves to lms/spark-x2.5-4b");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove provider" }));
    await waitFor(() => expect(posts(spy, "/verbs/provider/remove")).toEqual([{ input: { id: "or", force: true } }]));
    // The other provider does not hold the default: no force.
    const lms = screen.getByRole("region", { name: "Provider lms" });
    fireEvent.click(within(lms).getByRole("button", { name: "Remove provider lms" }));
    fireEvent.click(within(within(lms).getByRole("group", { name: "Confirm removing provider lms" })).getByRole("button", { name: "Remove provider" }));
    await waitFor(() => expect(posts(spy, "/verbs/provider/remove")).toHaveLength(2));
    expect(posts(spy, "/verbs/provider/remove")[1]).toEqual({ input: { id: "lms" } });
  });

  it("Add models fetches the provider's list with its saved URL and key name and adds the ticked ones", async () => {
    const spy = server();
    renderApp("/settings#settings-models");
    const or = await screen.findByRole("region", { name: "Provider or" });
    fireEvent.click(within(or).getByRole("button", { name: "Add models" }));
    fireEvent.click(within(or).getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(posts(spy, "/models/try")).toHaveLength(1));
    expect(posts(spy, "/models/try")[0]).toEqual({
      base_url: "https://openrouter.ai/api/v1",
      list_only: true,
      preset: "openrouter",
      key_env: "OPENROUTER_API_KEY",
    });
    const checklist = await within(or).findByRole("group", { name: "Models on or" });
    // Models already saved are ticked and locked.
    expect(within(checklist).getByRole("checkbox", { name: /a\/one/ })).toBeDisabled();
    expect(within(checklist).getByRole("checkbox", { name: /a\/one/ })).toBeChecked();
    fireEvent.click(within(checklist).getByRole("checkbox", { name: /c\/three/ }));
    fireEvent.click(within(or).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(posts(spy, "/verbs/model/add")).toEqual([
        { input: { provider: "or", models: ["c/three"], model_info: [{ id: "c/three", context_window: 131072, tool_calls: true }] } },
      ]),
    );
  });
});
