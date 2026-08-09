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
    // destructive tone.
    expect(pill.className).toContain("amber");
    expect(pill.className).not.toContain("destructive");
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
    expect(pill.className).toContain("destructive");
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
