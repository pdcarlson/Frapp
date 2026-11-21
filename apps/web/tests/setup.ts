import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { dropAllKeptDrafts } from "@repo/hooks/kept-drafts";

// Kept form drafts live in module memory for the tab (#4593); one test's
// draft must not open in the next test's form.
afterEach(() => {
  dropAllKeptDrafts();
});

// Radix UI primitives (Dialog, Switch, Select) and cmdk rely on a handful of
// DOM APIs that jsdom does not implement. Stub them (only when missing) so
// component tests can render these primitives without throwing.
if (typeof window !== "undefined") {
  if (typeof window.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof window.matchMedia === "undefined") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture =
      function releasePointerCapture() {};
  }
}
