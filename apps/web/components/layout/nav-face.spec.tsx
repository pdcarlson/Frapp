/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavChannelsTitle } from "./nav-face";

describe("NavChannelsTitle (#3824)", () => {
  it("is one 40px target spanning the arrow and the Channels title", () => {
    const onBack = vi.fn();
    render(<NavChannelsTitle onBack={onBack} />);

    const back = screen.getByRole("button", { name: "Back to menu" });
    expect(back).toHaveClass("h-10", "w-10");
    // The arrow's `::after` stretches over the `relative` title box, so a
    // click on the word Channels lands on the button. jsdom has no layout, so
    // this pins the classes that make it so.
    expect(back).toHaveClass("after:absolute", "after:inset-0");
    const box = back.parentElement!;
    expect(box).toHaveClass("relative");
    expect(box).toContainElement(
      screen.getByRole("heading", { name: "Channels" }),
    );
    // The button is not itself positioned, or the overlay would stop at it.
    expect(back.className).not.toMatch(/(^|\s)relative(\s|$)/);

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws no second Channels heading on the column's placeholder", () => {
    render(<NavChannelsTitle onBack={() => {}} heading={false} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
  });
});
