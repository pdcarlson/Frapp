import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";

/**
 * components.md § Icon-only actions: the word an icon-only control drops moves
 * to its accessible name and its hover tooltip, both from one `label`.
 */
describe("IconButton", () => {
  it("names the control and gives it a tooltip from the label", () => {
    render(<IconButton label="Download Bylaws">×</IconButton>);
    const button = screen.getByRole("button", { name: "Download Bylaws" });
    expect(button).toHaveAttribute("title", "Download Bylaws");
  });

  it("adds a caller's title after the label, which is how the offline reason shows", () => {
    render(
      <IconButton
        label="Delete Bylaws"
        title="Reconnect to make changes."
        disabled
      >
        ×
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Delete Bylaws" });
    expect(button).toHaveAttribute(
      "title",
      "Delete Bylaws. Reconnect to make changes.",
    );
    expect(button).toBeDisabled();
    // Disabled still takes the pointer, or the tooltip never shows.
    expect(button.className).toContain("disabled:pointer-events-auto");
  });

  it("keeps the label's tooltip when a gate spreads title: undefined", () => {
    // `gate.controlProps()` online: a bare `title=` placed before this spread
    // would be wiped, which is why the label lives on the component.
    const online = {
      disabled: false,
      title: undefined,
      "aria-describedby": undefined,
    };
    render(
      <IconButton label="Revoke the Member invite" {...online}>
        ×
      </IconButton>,
    );
    expect(
      screen.getByRole("button", { name: "Revoke the Member invite" }),
    ).toHaveAttribute("title", "Revoke the Member invite");
  });

  it("defaults to the quiet paint at the scale's Small step", () => {
    // foundations.md §9: an icon button is 36 to a mouse and 44 to a finger.
    render(<IconButton label="Edit North Library">×</IconButton>);
    const button = screen.getByRole("button", { name: "Edit North Library" });
    expect(button.className).toContain("text-muted-foreground");
    expect(button.className).toMatch(/(^| )h-9( |$)/);
    expect(button.className).toMatch(/(^| )w-9( |$)/);
    expect(button.className).toContain("pointer-coarse:h-11");
    expect(button.className).toContain("pointer-coarse:w-11");
  });
});
