import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, ToastAction, ToastProvider, ToastViewport } from "./toast";

/**
 * #2376: the destructive toast floats over whatever the page has in the
 * viewport corner, so its tint needs an opaque base under it. The base and the
 * tint are both `background-*` utilities on one element, which is exactly the
 * pair a class merger can mistake for a conflict and drop one of, so this
 * pins what survives `cn()`.
 */
const TINT =
  "bg-[linear-gradient(var(--destructive-tint),var(--destructive-tint))]";
const HOVER_TINT =
  "bg-[linear-gradient(var(--destructive-tint-hover),var(--destructive-tint-hover))]";

function renderDestructive() {
  render(
    <ToastProvider>
      <Toast variant="destructive" open data-testid="toast">
        <ToastAction altText="Retry">Retry</ToastAction>
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

  it("repaints the same base under its action's hover, not a second tint", () => {
    renderDestructive();
    const action = screen.getByRole("button", { name: "Retry" });
    expect(action).toHaveClass(
      "enabled:group-[.destructive]:hover:bg-popover",
      `enabled:group-[.destructive]:hover:${HOVER_TINT}`,
      "enabled:group-[.destructive]:text-destructive-text",
    );
    expect(action.className).not.toMatch(/hover:bg-destructive-tint-hover/);
  });
});
