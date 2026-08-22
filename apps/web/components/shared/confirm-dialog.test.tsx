import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import type { ConfirmResult } from "@/components/shared/confirm-dialog";

/**
 * The defect this file exists for.
 *
 * `window.prompt` answers `null` when a person cancels and `""` when they press
 * OK having typed nothing, and both of the flows this dialog replaced branch on
 * that difference — `tasks-board.tsx` and `service-page.tsx` each check
 * `=== null` and then pass `comment || undefined`. A confirmation that
 * collapsed the two would reject a task or a service entry at the moment
 * someone meant to abandon the rejection, which is the worst direction for it
 * to be wrong in: the member is notified either way.
 *
 * Nothing in the shipped suites reaches these paths — `tasks-board.test.tsx`
 * and `service-page.test.tsx` assert button enablement for §5's gating and stop
 * there — so before this file the whole confirmation path was untested on both
 * sides of the conversion.
 */

function Harness({
  onSettle,
}: {
  onSettle: (r: ConfirmResult | null) => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          onSettle(
            await confirm({
              title: "Reject this?",
              description: "The member is notified.",
              confirmLabel: "Reject entry",
              tone: "destructive",
              comment: { label: "Comment for the member" },
            }),
          );
        }}
      >
        Open
      </button>
      {confirmDialog}
    </div>
  );
}

function PlainHarness({ onSettle }: { onSettle: (r: unknown) => void }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          onSettle(
            await confirm({
              title: "Delete this?",
              description: "This can't be undone.",
              confirmLabel: "Delete study zone",
              tone: "destructive",
            }),
          );
        }}
      >
        Open
      </button>
      {confirmDialog}
    </div>
  );
}

describe("cancel and an empty comment are different answers", () => {
  it("resolves null when cancelled, so the caller's `=== null` guard still returns early", async () => {
    const user = userEvent.setup();
    const settled = vi.fn();
    render(<Harness onSettle={settled} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(settled).toHaveBeenCalledWith(null));
  });

  it("resolves an empty string — not null — when confirmed with nothing typed", async () => {
    // This is the assertion that would have caught a dialog resolving `null`
    // for "confirmed, no comment": the rejection is real and must proceed.
    const user = userEvent.setup();
    const settled = vi.fn();
    render(<Harness onSettle={settled} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Reject entry" }));

    await waitFor(() => expect(settled).toHaveBeenCalledWith({ comment: "" }));
  });

  it("carries the typed comment through", async () => {
    const user = userEvent.setup();
    const settled = vi.fn();
    render(<Harness onSettle={settled} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.type(
      screen.getByLabelText("Comment for the member"),
      "Needs receipts",
    );
    await user.click(screen.getByRole("button", { name: "Reject entry" }));

    await waitFor(() =>
      expect(settled).toHaveBeenCalledWith({ comment: "Needs receipts" }),
    );
  });

  it("treats Escape as cancel rather than as an empty confirmation", async () => {
    const user = userEvent.setup();
    const settled = vi.fn();
    render(<Harness onSettle={settled} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(settled).toHaveBeenCalledWith(null));
  });

  it("does not leave a stale comment on the next confirmation", async () => {
    const user = userEvent.setup();
    const settled = vi.fn();
    render(<Harness onSettle={settled} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.type(screen.getByLabelText("Comment for the member"), "first");
    await user.click(screen.getByRole("button", { name: "Reject entry" }));
    await waitFor(() =>
      expect(settled).toHaveBeenCalledWith({ comment: "first" }),
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Reject entry" }));
    await waitFor(() =>
      expect(settled).toHaveBeenLastCalledWith({ comment: "" }),
    );
  });
});

describe("the confirmation is in-product, and reads as a verb", () => {
  it("never calls the banned browser dialogs", async () => {
    // `README.md` §2 bans `window.confirm` "(and other browser-chrome dialogs)"
    // on every surface, not only Signet ones.
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const nativePrompt = vi.spyOn(window, "prompt").mockReturnValue("x");
    render(<PlainHarness onSettle={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Delete study zone" }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(nativePrompt).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
    nativePrompt.mockRestore();
  });

  it("labels the action with its verb and object, never a bare 'Confirm'", async () => {
    // `writing.md` §2's CTA rule, and it is also what keeps the screens' own
    // suites unambiguous: `tasks-board.test.tsx` queries `/^delete$/i` and
    // `service-page.test.tsx` queries `/reject/i` against the page's buttons.
    const user = userEvent.setup();
    render(<PlainHarness onSettle={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(
      screen.queryByRole("button", { name: /^confirm$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete study zone" }),
    ).toBeInTheDocument();
  });
});
