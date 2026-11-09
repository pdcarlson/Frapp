// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DueDateField } from "./due-date-field";

// Monday, 9 November 2026.
const NOW = new Date(2026, 10, 9, 12);

function Harness({
  initial = "",
  missing,
  onValue,
}: {
  initial?: string;
  missing?: boolean;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DueDateField
        aria-label="Due date"
        now={NOW}
        missing={missing}
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <button type="button" onClick={() => setValue("")}>
        reset
      </button>
      <button type="button" onClick={() => setValue("2027-03-14")}>
        prefill
      </button>
    </>
  );
}

const field = () => screen.getByLabelText("Due date");
const type = (text: string) =>
  fireEvent.change(field(), { target: { value: text } });

describe("DueDateField (#3928)", () => {
  it("takes a month and a day and fills in the year", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("11/14");
    expect(onValue).toHaveBeenLastCalledWith("2026-11-14");
    // What it was read as shows while the text is still the member's own.
    expect(screen.getByText("Sat, Nov 14")).toBeInTheDocument();
    fireEvent.blur(field());
    expect(field()).toHaveValue("Sat, Nov 14");
  });

  it("shows the year when the date is not in the current one", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("jan 5");
    expect(onValue).toHaveBeenLastCalledWith("2027-01-05");
    fireEvent.blur(field());
    expect(field()).toHaveValue("Jan 5, 2027");
  });

  it("takes a typed year for a date further out", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("Nov 14 2028");
    expect(onValue).toHaveBeenLastCalledWith("2028-11-14");
    expect(screen.getByText("Nov 14, 2028")).toBeInTheDocument();
  });

  it("is not a native date input, which asks for the year", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("type", "text");
  });

  it("holds no date while the text is not one, and says so on leaving", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("soon");
    expect(onValue).toHaveBeenLastCalledWith("");
    // Never while typing.
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(field());
    expect(screen.getByRole("alert")).toHaveTextContent(/Nov 14 or 11\/14/);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveValue("soon");
  });

  it("asks for a date when the form was submitted without one", () => {
    render(<Harness missing />);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a due date.");
  });

  it("follows a date the parent sets, and clears with it", () => {
    render(<Harness initial="2026-11-12" />);
    expect(field()).toHaveValue("Thu, Nov 12");
    fireEvent.click(screen.getByRole("button", { name: "prefill" }));
    expect(field()).toHaveValue("Mar 14, 2027");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(field()).toHaveValue("");
  });
});
