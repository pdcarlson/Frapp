import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_DIAGNOSTICS_COPY } from "@repo/validation";

/**
 * The beta diagnostics window's row (#4315): only where the server offers
 * it, the president's to change, and never changed without a confirmation.
 */

const state = vi.hoisted(() => ({
  diagnostics: null as null | {
    offered: boolean;
    can_change: boolean;
    ends_at: string | null;
  },
  set: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAskStatus: () => ({
    data: state.diagnostics
      ? { saved_until: state.diagnostics.ends_at, diagnostics: state.diagnostics }
      : null,
  }),
  useSetAskDiagnostics: () => ({ mutateAsync: state.set, isPending: false }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false, probeOnce: vi.fn() }),
}));

const { AskDiagnosticsRow } = await import("./ask-diagnostics-row");

describe("AskDiagnosticsRow", () => {
  beforeEach(() => {
    state.set.mockReset().mockResolvedValue(undefined);
    state.toast.mockReset();
  });

  it("draws nothing for a chapter the window is not offered to", () => {
    state.diagnostics = { offered: false, can_change: true, ends_at: null };
    const { container } = render(<AskDiagnosticsRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing on a server with no AI", () => {
    state.diagnostics = null;
    const { container } = render(<AskDiagnosticsRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts only after the president confirms", async () => {
    state.diagnostics = { offered: true, can_change: true, ends_at: null };
    render(<AskDiagnosticsRow />);
    const user = userEvent.setup();
    expect(screen.getByText(ASK_DIAGNOSTICS_COPY.off)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ASK_DIAGNOSTICS_COPY.start }));
    expect(state.set).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(ASK_DIAGNOSTICS_COPY.confirmStartTitle);
    await user.click(screen.getByRole("button", { name: ASK_DIAGNOSTICS_COPY.cancel }));
    expect(state.set).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: ASK_DIAGNOSTICS_COPY.start }));
    const again = await screen.findByRole("dialog");
    const confirm = Array.from(again.querySelectorAll("button")).find(
      (button) => button.textContent === ASK_DIAGNOSTICS_COPY.confirmStart,
    )!;
    await user.click(confirm);
    expect(state.set).toHaveBeenCalledWith(true);
  });

  it("names the end date while it is on, and stops through a confirmation", async () => {
    state.diagnostics = {
      offered: true,
      can_change: true,
      ends_at: "2026-11-26T12:00:00.000Z",
    };
    render(<AskDiagnosticsRow />);
    expect(screen.getByText("Saving until November 26, 2026.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: ASK_DIAGNOSTICS_COPY.stop }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(ASK_DIAGNOSTICS_COPY.confirmStopTitle);
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === ASK_DIAGNOSTICS_COPY.confirmStop,
    )!;
    await user.click(confirm);
    expect(state.set).toHaveBeenCalledWith(false);
  });

  it("is read-only for anyone but the president", () => {
    state.diagnostics = {
      offered: true,
      can_change: false,
      ends_at: "2026-11-26T12:00:00.000Z",
    };
    render(<AskDiagnosticsRow />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(ASK_DIAGNOSTICS_COPY.presidentOnly)).toBeInTheDocument();
  });
});
