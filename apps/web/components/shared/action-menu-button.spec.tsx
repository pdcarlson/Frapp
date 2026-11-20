import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionMenuButton } from "./row-menu";

describe("ActionMenuButton", () => {
  it("shows the same entries from an always-visible header ⋯", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ActionMenuButton
        label="More for Chapter Meeting"
        entries={[{ type: "item", key: "dup", label: "Duplicate", onSelect }]}
      />,
    );
    const button = screen.getByRole("button", {
      name: "More for Chapter Meeting",
    });
    expect(button.className).not.toMatch(/\bopacity-0\b/);
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onSelect).toHaveBeenCalled();
  });
});
