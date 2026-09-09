import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OfflineBanner } from "./offline-banner";
import {
  DASHBOARD_HEADER_STICKY_CLASS,
  OFFLINE_BANNER_HEIGHT_VAR,
} from "./offline-banner-focus";
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
    expect(banner).toHaveClass("border-warning/45 bg-warning/[.13] text-warning");
    expect(banner).toHaveClass("sticky", "top-0", "z-40");
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
    // `spec/ui/resilience.md` § 2's OFFLINE banner cell, verbatim, and what
    // mobile ships. The trailing "Changes will sync when you reconnect." was
    // dropped in #1707: queueless writes now reject rather than pausing, so
    // page chrome promising a sync on every route contradicts § 1 principle 1,
    // "actions must never appear to succeed when they haven't". Only the chat
    // composer has an outbox, and it states that at the control itself.
    expect(banner).toHaveTextContent("You're offline. Showing cached data.");
    expect(banner).not.toHaveTextContent(/will sync/i);
    expect(banner).toHaveClass(
      "border-destructive/45 bg-destructive/[.13] text-destructive",
    );
    // #1746: the banner must outrank the dashboard header (z-30) and stick at
    // the viewport top so a long page cannot scroll the only OFFLINE signal
    // away. jsdom does not paint `position: sticky`; the class is the contract.
    expect(banner).toHaveClass("sticky", "top-0", "z-40");
  });

  it("publishes its height so the dashboard header sits below it, and clears it on unmount", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "OFFLINE",
      isOnline: false,
      isDegraded: false,
      isOffline: true,
      linkOnline: false,
      probeOnce: async () => {},
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 40,
      width: 375,
      top: 0,
      left: 0,
      bottom: 40,
      right: 375,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const { unmount } = render(<OfflineBanner />);

    expect(
      document.documentElement.style.getPropertyValue(OFFLINE_BANNER_HEIGHT_VAR),
    ).toBe("40px");
    expect(DASHBOARD_HEADER_STICKY_CLASS).toContain(
      `top-[var(${OFFLINE_BANNER_HEIGHT_VAR},0px)]`,
    );

    unmount();
    expect(
      document.documentElement.style.getPropertyValue(OFFLINE_BANNER_HEIGHT_VAR),
    ).toBe("");
    vi.restoreAllMocks();
  });
});
