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
    expect(banner).toHaveClass("bg-amber-50 text-amber-800 border-amber-200");
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
    expect(banner).toHaveClass("bg-red-50 text-red-800 border-red-200");
  });
});
