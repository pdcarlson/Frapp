import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast";

/**
 * #2376: the destructive toast floats over whatever the page has in the
 * viewport corner, so its tint needs an opaque base under it. The base and the
 * tint are both `background-*` utilities on one element, which is exactly the
 * pair a class merger can mistake for a conflict and drop one of, so this
 * pins what survives `cn()`.
 */
const TINT =
  "bg-[linear-gradient(var(--destructive-tint),var(--destructive-tint))]";

function renderDestructive() {
  render(
    <ToastProvider>
      <Toast variant="destructive" open data-testid="toast">
        <ToastTitle>Save failed</ToastTitle>
        <ToastDescription>Check your connection.</ToastDescription>
        <ToastClose aria-label="Close" />
      </Toast>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("the destructive toast", () => {
  it("paints its tint over an opaque --popover", () => {
    renderDestructive();
    const toast = screen.getByTestId("toast");
    expect(toast).toHaveClass("bg-popover", TINT, "text-destructive-text");
  });

  it("keeps every label on it in the lifted danger tone", () => {
    // Solid `--destructive` on the tint over `--popover` is 3.82:1. The
    // children sit on a tint their own classes do not paint, which is exactly
    // what `status-tint-call-sites.spec.ts` cannot see, so they are held here.
    renderDestructive();
    const title = screen.getByText("Save failed");
    const description = screen.getByText("Check your connection.");
    const close = screen.getByRole("button", { name: "Close" });

    // The title sets no colour and inherits the root's lift.
    expect(title.className).not.toMatch(/text-destructive(?!-text)/);
    for (const label of [description, close]) {
      expect(label).toHaveClass("group-[.destructive]:text-destructive-text");
      expect(label.className).not.toMatch(
        /group-\[\.destructive\]:(?:hover:)?text-destructive(?!-text)/,
      );
    }
  });
});
