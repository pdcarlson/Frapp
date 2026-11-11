import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportantStrip } from "./important-strip";

const next = {
  id: "m1",
  created_at: "2026-11-11T15:17:00.000Z",
  flagged_at: "2026-11-11T15:17:00.000Z",
  sender_id: "sam",
  author_name: null,
  excerpt: "reminder that composite headshots are Friday at 4",
};

function renderStrip(
  total: number,
  overrides: { nextSender?: string | null } = {},
) {
  const onJump = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ImportantStrip
      total={total}
      next={total > 0 ? next : null}
      nextSender={
        "nextSender" in overrides ? overrides.nextSender! : "Sam Abernathy"
      }
      onJump={onJump}
      onDismiss={onDismiss}
    />,
  );
  return { onJump, onDismiss };
}

describe("ImportantStrip (#4186)", () => {
  it("keeps an empty live region mounted while nothing is unseen", () => {
    renderStrip(0);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("names the count, the sender and the first words", () => {
    renderStrip(1);
    const jump = screen.getByRole("button", { name: /1 important message/ });
    expect(jump).toHaveTextContent(
      "1 important message· Sam Abernathy: reminder that composite headshots are Friday at 4Jump",
    );
  });

  it("counts several in the plural", () => {
    renderStrip(3);
    expect(
      screen.getByRole("button", { name: /3 important messages/ }),
    ).toBeInTheDocument();
  });

  it("leaves the sender out when there is no name", () => {
    renderStrip(1, { nextSender: null });
    expect(
      screen.getByRole("button", { name: /1 important message/ }),
    ).not.toHaveTextContent(":");
  });

  it("jumps on a click anywhere on the strip, and dismisses on ×", async () => {
    const user = userEvent.setup();
    const { onJump, onDismiss } = renderStrip(2);

    await user.click(screen.getByText(/reminder that composite/));
    expect(onJump).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Dismiss important messages" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("wears the Important row's paint", () => {
    renderStrip(1);
    const strip = document.querySelector('[data-slot="important-strip"]');
    expect(strip).toHaveClass(
      "bg-destructive-tint",
      "shadow-[inset_2px_0_0_var(--destructive)]",
    );
  });
});
