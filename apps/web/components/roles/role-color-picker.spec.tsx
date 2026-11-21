import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isPaintableRoleColor, roleColorForHue } from "@repo/validation";

import { RoleColorPicker } from "./role-color-picker";

function Harness({
  initial,
  onChange,
}: {
  initial: string | null;
  onChange?: (next: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <span id="color-label">Color</span>
      <RoleColorPicker
        labelId="color-label"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </>
  );
}

describe("RoleColorPicker", () => {
  it("picks a palette swatch and clears it with No color", () => {
    const onChange = vi.fn();
    render(<Harness initial={null} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Teal" }));
    expect(onChange).toHaveBeenLastCalledWith("#3DD6C4");
    expect(screen.getByRole("button", { name: "Teal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "No color" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("saves the readable color a hue paints, and shows it as the custom swatch", () => {
    const onChange = vi.fn();
    render(<Harness initial={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Custom hue" }), {
      target: { value: "200" },
    });
    const saved = roleColorForHue(200).hex;
    expect(onChange).toHaveBeenLastCalledWith(saved);
    expect(isPaintableRoleColor(saved)).toBe(true);
    expect(
      screen.getByRole("button", { name: "Custom color" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("says why when the slider sits in red or gold, and saves the nearest allowed color", () => {
    const onChange = vi.fn();
    render(<Harness initial={null} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Custom hue" });
    fireEvent.change(slider, { target: { value: "27" } });
    expect(
      screen.getByText(/Red is kept for alerts and mentions/),
    ).toBeVisible();
    expect(onChange).toHaveBeenLastCalledWith(roleColorForHue(27).hex);
    fireEvent.change(slider, { target: { value: "82" } });
    expect(
      screen.getByText(/Gold is kept for Frapp's own color/),
    ).toBeVisible();
    fireEvent.change(slider, { target: { value: "150" } });
    expect(screen.queryByText(/is kept for/)).toBeNull();
  });

  it("places the thumb on a stored custom color's hue", () => {
    const stored = roleColorForHue(265).hex;
    render(<Harness initial={stored} />);
    const slider = screen.getByRole("slider", { name: "Custom hue" });
    expect(
      Math.abs(Number((slider as HTMLInputElement).value) - 265),
    ).toBeLessThan(3);
  });
});
