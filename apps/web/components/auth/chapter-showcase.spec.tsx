import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { ChapterShowcase, SHOWCASE_FINAL } from "./chapter-showcase";

function mockMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

/**
 * Advance in small steps, each in its own `act`, because the clock schedules
 * its next timeout in an effect after every render: one big advance inside a
 * single `act` would fire the first timeout and never see the next.
 */
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    act(() => {
      vi.advanceTimersByTime(50);
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ChapterShowcase", () => {
  it("is a picture: hidden from assistive tech, with nothing to focus", () => {
    mockMotion(false);
    const { container } = render(<ChapterShowcase />);
    const panel = container.firstElementChild!;
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(
      panel.querySelectorAll("button, a, input, [tabindex], h1, h2, h3"),
    ).toHaveLength(0);
  });

  it("opens on the finished frame, so the first paint is complete", () => {
    mockMotion(false);
    const { container } = render(<ChapterShowcase />);
    const text = container.textContent ?? "";
    expect(text).toContain("31 checked in");
    expect(text).toContain("Done");
    expect(text).toContain("36 votes");
  });

  it("stays on the finished frame under reduced motion", () => {
    vi.useFakeTimers();
    mockMotion(true);
    const { container } = render(<ChapterShowcase />);
    advance(SHOWCASE_FINAL * 2);
    expect(container.textContent).toContain("31 checked in");
    expect(container.textContent).toContain("36 votes");
  });

  it("plays the scene from the top when motion is allowed, then loops", () => {
    vi.useFakeTimers();
    mockMotion(false);
    const { container } = render(<ChapterShowcase />);
    // Hold, fade, restart: the feed empties, then the first post returns.
    advance(4000);
    expect(container.textContent).not.toContain("Jordan Reyes");
    advance(500);
    expect(container.textContent).toContain("Jordan Reyes");
    expect(container.textContent).not.toContain("Maya Kim");
  });

  it("draws only what the beta ships", () => {
    // Bounded by `spec/behavior/` like the landing frames: the event card has
    // Check in and nothing else (RSVP intent is not modelled), the dues
    // renderer is a stub, and Ask is not built.
    mockMotion(false);
    const { container } = render(<ChapterShowcase />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bgoing\b|rsvp|dues|ask frapp|signet/i);
    expect(text).not.toMatch(/[Α-Ωα-ω]/);
  });
});
