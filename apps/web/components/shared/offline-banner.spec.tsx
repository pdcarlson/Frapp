import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OfflineBanner } from "./offline-banner";
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
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Slow connection. Some features may be delayed.");
    // The Signet warning tint — degraded is a status, so it takes a semantic
    // hue rather than a palette colour (foundations.md §5).
    expect(banner).toHaveClass("border-warning/45 bg-warning/[.13] text-warning");
  });

  it("renders offline banner when the network state is OFFLINE", () => {
    vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
      state: "OFFLINE",
      isOnline: false,
      isDegraded: false,
      isOffline: true,
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("You're offline. Showing cached data. Changes will sync when you reconnect.");
    expect(banner).toHaveClass(
      "border-destructive/45 bg-destructive/[.13] text-destructive",
    );
  });
});
