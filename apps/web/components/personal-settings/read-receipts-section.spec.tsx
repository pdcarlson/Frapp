import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  ready: true,
  pending: false,
  failed: false,
  setEnabled: vi.fn(),
  toast: vi.fn(),
  offline: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useReadReceiptsSetting: () => ({
    enabled: state.enabled,
    ready: state.ready,
    pending: state.pending,
    failed: state.failed,
    setEnabled: state.setEnabled,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: state.offline, probeOnce: vi.fn() }),
}));

const { ReadReceiptsSection } = await import("./read-receipts-section");

/** Settings → Appearance and chat → Read receipts (#5519). */
describe("ReadReceiptsSection", () => {
  beforeEach(() => {
    Object.assign(state, {
      enabled: true,
      ready: true,
      pending: false,
      failed: false,
      offline: false,
    });
    state.setEnabled.mockReset();
    state.toast.mockReset();
  });

  it("shows the member's switch, on by default, and turns it off", async () => {
    render(<ReadReceiptsSection />);
    const toggle = screen.getByRole("switch", { name: "Read receipts" });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(/you won't see when they've read yours/i),
    ).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(state.setEnabled).toHaveBeenCalledWith(false);
  });

  it("shows off for a member who turned it off", () => {
    state.enabled = false;
    render(<ReadReceiptsSection />);
    expect(
      screen.getByRole("switch", { name: "Read receipts" }),
    ).not.toBeChecked();
  });

  it("draws nothing until settings answer, so it never flips under the member", () => {
    state.ready = false;
    const { container } = render(<ReadReceiptsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("holds the switch while a save is in flight or the browser is offline", () => {
    state.pending = true;
    const { unmount } = render(<ReadReceiptsSection />);
    expect(screen.getByRole("switch", { name: "Read receipts" })).toBeDisabled();
    unmount();

    state.pending = false;
    state.offline = true;
    render(<ReadReceiptsSection />);
    expect(screen.getByRole("switch", { name: "Read receipts" })).toBeDisabled();
  });

  it("says once when a save failed", () => {
    state.failed = true;
    const { rerender } = render(<ReadReceiptsSection />);
    rerender(<ReadReceiptsSection />);
    expect(state.toast).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
