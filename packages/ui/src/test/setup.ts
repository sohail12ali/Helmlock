import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installFetch } from "./server";

// Lazy routes and viewers load on first use; give them time on a cold transform.
configure({ asyncUtilTimeout: 5000 });

// jsdom gaps used by the shell and the panels library.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= () => {};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
