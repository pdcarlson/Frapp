import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReconnectPill } from "./reconnect-pill";

// The polling copy is fixed by spec/ui/resilience.md §3.2. Asserting it
// verbatim means a reworded banner fails here rather than silently drifting
// from the spec.
const SPEC_POLLING_COPY = "Real-time updates paused. Polling for new messages.";

describe("ReconnectPill", () => {
  it("renders nothing while the connection is live", () => {
    const { container } = render(<ReconnectPill status="live" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the spec'd polling copy when degraded to polling", () => {
    render(<ReconnectPill status="polling" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent(SPEC_POLLING_COPY);
    // Degraded-but-receiving is a warning, not an error — offline owns the
    // destructive tone. `warning`, not `amber-500`: the pill used to paint raw
    // Tailwind palette with an inert `dark:` twin, and this assertion is what
    // would have caught a revert to it.
    expect(pill.className).toContain("warning");
    expect(pill.className).not.toContain("destructive");
  });

  it("paints from semantic tokens, never the raw palette", () => {
    for (const status of ["polling", "reconnecting", "offline"] as const) {
      const { unmount } = render(<ReconnectPill status={status} />);
      const pill = screen.getByRole("status");
      // Signet is dark-only, so a `dark:` variant here is dead code that ships
      // its light branch — the exact defect this replaced.
      expect(pill.className).not.toMatch(/\b(amber|red|emerald|yellow)-\d/);
      expect(pill.className).not.toContain("dark:");
      unmount();
    }
  });

  it("distinguishes polling from plain reconnecting", () => {
    render(<ReconnectPill status="reconnecting" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Reconnecting…");
    expect(pill).not.toHaveTextContent(SPEC_POLLING_COPY);
  });

  it("keeps the offline state distinct and destructive-toned", () => {
    render(<ReconnectPill status="offline" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent(
      "Offline — messages will send when you reconnect",
    );
    // The AA-lifted tone: `--destructive` on its own 13% tint measures 4.39:1
    // over `--card`, under README §6's 4.5:1 floor (components.md §1).
    expect(pill.className).toContain("text-destructive-text");
  });

  it("announces politely for screen readers in every degraded state", () => {
    for (const status of ["polling", "reconnecting", "offline"] as const) {
      const { unmount } = render(<ReconnectPill status={status} />);
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      unmount();
    }
  });
});
