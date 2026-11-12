// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DateLean } from "@repo/formatting";
import { DateField } from "./date-field";

// Monday, 9 November 2026.
const NOW = new Date(2026, 10, 9, 12);

function Harness({
  initial = "",
  lean,
  onValue,
}: {
  initial?: string;
  lean?: DateLean;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      aria-label="Date"
      now={NOW}
      lean={lean}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const field = () => screen.getByLabelText("Date");
const type = (text: string) =>
  fireEvent.change(field(), { target: { value: text } });

describe("DateField (#3937)", () => {
  it("leans back for a day that already happened", () => {
    const onValue = vi.fn();
    render(<Harness lean="back" onValue={onValue} />);
    type("11/14");
    expect(onValue).toHaveBeenLastCalledWith("2025-11-14");
    type("fri");
    expect(onValue).toHaveBeenLastCalledWith("2026-11-06");
    fireEvent.blur(field());
    expect(field()).toHaveValue("Friday");
  });

  it("writes today and yesterday out", () => {
    render(<Harness lean="back" initial="2026-11-08" />);
    expect(field()).toHaveValue("Yesterday");
  });

  it("opens a month on a click, and a picked day fills the field", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-12" onValue={onValue} />);
    fireEvent.pointerDown(field());
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("gridcell", { name: "Friday, November 20, 2026" }),
    );
    expect(onValue).toHaveBeenLastCalledWith("2026-11-20");
    expect(field()).toHaveValue("November 20");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("steps between months", () => {
    render(<Harness />);
    fireEvent.pointerDown(field());
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid", { name: "December 2026" })).toBeVisible();
  });

  it("marks unreadable text invalid once the member leaves it", () => {
    render(<Harness />);
    fireEvent.focus(field());
    type("soon");
    expect(field()).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(field());
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveValue("soon");
  });
});
