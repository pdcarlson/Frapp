import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ACCENT_PRESETS } from "@repo/hooks/chapter-identity";
import { AccentSwatches } from "./accent-swatches";

describe("AccentSwatches", () => {
  it("leads with the organization's own colors, named", () => {
    render(<AccentSwatches value="#4F2683" orgName="Phi Gamma Delta" onPick={() => {}} />);
    const org = screen.getByRole("group", { name: "Your organization's colors" });
    const purple = within(org).getByRole("button", { name: "Royal Purple" });
    expect(purple).toHaveAttribute("aria-pressed", "true");
    expect(org).toHaveTextContent("Royal Purple");
    // Looked up by name; the letters it doesn't display appear nowhere.
    expect(document.body.textContent).not.toMatch(/[Α-ω]/);
  });

  it("offers the common colors when the organization is unknown", () => {
    render(<AccentSwatches value="#000000" orgName="Test Chapter" onPick={() => {}} />);
    expect(screen.queryByRole("group", { name: "Your organization's colors" })).toBeNull();
    const more = screen.getByRole("group", { name: "More colors" });
    expect(within(more).getAllByRole("button")).toHaveLength(ACCENT_PRESETS.length);
    for (const button of within(more).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("picks a swatch's seed on click", () => {
    const onPick = vi.fn();
    render(<AccentSwatches value="" orgName={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Navy" }));
    expect(onPick).toHaveBeenCalledWith("#1D2F6F");
  });

  it("can't pick while disabled", () => {
    const onPick = vi.fn();
    render(<AccentSwatches value="" orgName={null} onPick={onPick} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Navy" }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
