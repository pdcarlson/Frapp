import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { BANNER_REDISPLAY_MS, OfflineBanner } from "./offline-banner";
import { DASHBOARD_SHELL_ATTR } from "./offline-banner-focus";
import * as NetworkProvider from "@/lib/providers/network-provider";

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: vi.fn(),
}));

describe("OfflineBanner", () => {
  it("renders nothing when the network state is ONLINE", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "ONLINE",
      isOnline: true,
      isDegraded: false,
      isOffline: false,
      linkOnline: true,
      probeOnce: async () => {},
    });

    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders degraded banner when the network state is DEGRADED", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "DEGRADED",
      isOnline: false,
      isDegraded: true,
      isOffline: false,
      linkOnline: true,
      probeOnce: async () => {},
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Slow connection. Some features may be delayed.");
    // The Signet warning tint — degraded is a status, so it takes a semantic
    // hue rather than a palette colour (foundations.md §5).
    expect(banner).toHaveClass("bg-background");
    expect(banner.firstElementChild).toHaveClass(
      "border-warning/45 bg-warning/[.13] text-warning",
    );
  });

  it("renders offline banner when the network state is OFFLINE", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "OFFLINE",
      isOnline: false,
      isDegraded: false,
      isOffline: true,
      linkOnline: false,
      probeOnce: async () => {},
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("id", "frapp-offline-banner");
    expect(banner).toHaveAttribute("tabindex", "-1");
    // `spec/ui/resilience/connection-state.md`'s OFFLINE banner cell, verbatim, and what
    // mobile ships. The trailing "Changes will sync when you reconnect." was
    // dropped in #1707: queueless writes now reject rather than pausing, so
    // page chrome promising a sync on every route contradicts principles.md,
    // "actions must never appear to succeed when they haven't". Only the chat
    // composer has an outbox, and it states that at the control itself.
    expect(banner).toHaveTextContent("You're offline. Showing cached data.");
    expect(banner).not.toHaveTextContent(/will sync/i);
    // Opaque `bg-background` so the page it floats over cannot show through
    // the 13% semantic tint, and the contrast it was measured at still holds.
    expect(banner).toHaveClass("bg-background");
    expect(banner.firstElementChild).toHaveClass(
      "border-destructive/45 bg-destructive/[.13] text-destructive",
    );
  });

  /*
   * #2244. The banner used to sit in flow above the dashboard shell and
   * publish its height for the shell to subtract, so every state change after
   * paint moved the nav, the top bar and every page title. It must take no
   * layout space: a fixed overlay, and nothing written to the document for
   * anything else to make room with.
   */
  it("floats over the page instead of taking layout space", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "DEGRADED",
      isOnline: false,
      isDegraded: true,
      isOffline: false,
      linkOnline: true,
      probeOnce: async () => {},
    });

    const { container } = render(<OfflineBanner />);

    const overlay = container.firstElementChild;
    expect(overlay).toHaveClass("fixed", "z-40", "pointer-events-none");
    expect(overlay?.className).not.toMatch(/\bsticky\b/);
    // Below the 48px top bar when the shell is mounted. The attribute is
    // spelled literally in the class (Tailwind has to see it), so pin it to
    // the constant the shell spec pins its side against.
    expect(overlay?.className).toContain(
      `[html:has([${DASHBOARD_SHELL_ATTR}])_&]:top-14`,
    );
    expect(document.documentElement.getAttribute("style") ?? "").toBe("");
  });

  it("lets taps through to the page it covers, except on its dismiss control", () => {
    // Floating puts it over the first row of content: a page's title and
    // actions, or chat's Back and channel-menu buttons on a phone. Neither the
    // wrapper nor the pill may take a pointer, or those controls go dead for
    // as long as the connection is down.
    mockNetwork("OFFLINE");
    const { container } = render(<OfflineBanner />);

    const pill = screen.getByRole("alert");
    expect(container.firstElementChild).toHaveClass("pointer-events-none");
    expect(pill.className).not.toMatch(/pointer-events-auto/);
    expect(
      screen.getByRole("button", { name: "Dismiss the connection notice" }),
    ).toHaveClass("pointer-events-auto");
  });

  describe("dismissal (connection-state.md: reappears after 30s if the state holds)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("hides on dismiss and comes back after the redisplay delay", () => {
      vi.useFakeTimers();
      mockNetwork("DEGRADED");
      render(<OfflineBanner />);

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss the connection notice" }),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(BANNER_REDISPLAY_MS - 1);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Slow connection.");
    });

    it("comes back at once when the state changes, because the dismissal was of the old state", () => {
      mockNetwork("DEGRADED");
      const { rerender } = render(<OfflineBanner />);

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss the connection notice" }),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      mockNetwork("OFFLINE");
      rerender(<OfflineBanner />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You're offline. Showing cached data.",
      );
    });
  });
});

function mockNetwork(state: "DEGRADED" | "OFFLINE") {
  vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
    state,
    isOnline: false,
    isDegraded: state === "DEGRADED",
    isOffline: state === "OFFLINE",
    linkOnline: state === "DEGRADED",
    probeOnce: async () => {},
  });
}
