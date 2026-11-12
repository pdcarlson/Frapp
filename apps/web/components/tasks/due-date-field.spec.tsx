// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DueDateField, dueEntryPassed } from "./due-date-field";

// Monday, 9 November 2026.
const NOW = new Date(2026, 10, 9, 12);

function Harness({
  initial = "",
  missing,
  passed,
  onValue,
}: {
  initial?: string;
  missing?: boolean;
  passed?: boolean;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DueDateField
        aria-label="Due date"
        now={NOW}
        missing={missing}
        passed={passed}
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
    expect(screen.getByText("Saturday, November 14")).toBeInTheDocument();
    fireEvent.blur(field());
    expect(field()).toHaveValue("Saturday");
  });

  it("shows the year when the date is not in the current one", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("jan 5");
    expect(onValue).toHaveBeenLastCalledWith("2027-01-05");
    fireEvent.blur(field());
    expect(field()).toHaveValue("January 5, 2027");
  });

  it("takes a typed year for a date further out", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("Nov 14 2028");
    expect(onValue).toHaveBeenLastCalledWith("2028-11-14");
    expect(screen.getByText("Tuesday, November 14, 2028")).toBeInTheDocument();
  });

  it("is not a native date input, which asks for the year", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("type", "text");
  });

  it("holds no date while the text is not one, and says nothing until a submit", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("soon");
    expect(onValue).toHaveBeenLastCalledWith("");
    fireEvent.blur(field());
    // Nothing under the field comes or goes on blur: a line that did would
    // move the form's buttons out from under a click.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field()).toHaveValue("soon");
  });

  it("asks for a date when the form was submitted without one", () => {
    render(<Harness missing />);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a due date.");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("Pick a due date.");
  });

  it("says how to write one when the form was submitted with unreadable text", () => {
    render(<Harness missing />);
    type("soon");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /November 14 or Friday/,
    );
    type("11/14");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads a time with the date, and hands the parent both (#4003)", () => {
    render(<Harness />);
    type("11/14 5pm");
    expect(screen.getByText("Saturday, November 14")).toBeInTheDocument();
    fireEvent.blur(field());
    expect(field()).toHaveValue("Saturday · 5 PM");
  });

  it("heads the floating month with the reading, so blur changes no height", () => {
    const { container } = render(<Harness />);
    type("11/14");
    // The month is portaled over the page, out of the form's flow.
    const reading = screen.getByText("Saturday, November 14");
    expect(container.contains(reading)).toBe(false);
    // A screen reader hears the reading, the filled-in year included.
    expect(field()).toHaveAccessibleDescription("Saturday, November 14");
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("keeps a past date's year, so editing it doesn't move it a year on", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-02" onValue={onValue} />);
    expect(field()).toHaveValue("November 2, 2026");
    type("November 2, 2026 ");
    expect(onValue).toHaveBeenLastCalledWith("2026-11-02");
  });

  it("follows a date the parent sets, and clears with it", () => {
    render(<Harness initial="2026-11-12" />);
    expect(field()).toHaveValue("Thursday");
    fireEvent.click(screen.getByRole("button", { name: "prefill" }));
    expect(field()).toHaveValue("March 14, 2027");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(field()).toHaveValue("");
  });
});

describe("DueDateField's time of day (#4512)", () => {
  const addTime = () => screen.getByRole("button", { name: "Add a time" });
  const time = () => screen.getByLabelText("Due time");

  it("starts with no time, as a quiet Add a time", () => {
    render(<Harness initial="2026-11-14" />);
    expect(addTime()).toBeInTheDocument();
    expect(screen.queryByLabelText("Due time")).toBeNull();
  });

  it("adds a time at 5 PM, the phone's starting point", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-14" onValue={onValue} />);
    fireEvent.click(addTime());
    expect(onValue).toHaveBeenLastCalledWith("2026-11-14T17:00");
    expect(time()).toHaveValue("17:00");
    // The date field writes the time in with the day.
    expect(field()).toHaveValue("Saturday · 5 PM");
  });

  it("gives a time with no date picked yet today's date", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(addTime());
    expect(onValue).toHaveBeenLastCalledWith("2026-11-09T17:00");
  });

  it("changes the time and keeps the day", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-14T17:00" onValue={onValue} />);
    fireEvent.change(time(), { target: { value: "09:30" } });
    expect(onValue).toHaveBeenLastCalledWith("2026-11-14T09:30");
    expect(field()).toHaveValue("Saturday · 9:30 AM");
  });

  it("holds the last whole time while the browser's field is half retyped", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-14T17:00" onValue={onValue} />);
    fireEvent.change(time(), { target: { value: "" } });
    expect(onValue).not.toHaveBeenCalled();
    expect(time()).toBeInTheDocument();
  });

  it("takes any minute, not only five-minute steps", () => {
    render(<Harness initial="2026-11-14T17:03" />);
    expect(time()).not.toHaveAttribute("step");
    expect(time()).toHaveValue("17:03");
  });

    it("takes the time off and keeps the day", () => {
    const onValue = vi.fn();
    render(<Harness initial="2026-11-14T17:00" onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove the time" }));
    expect(onValue).toHaveBeenLastCalledWith("2026-11-14");
    expect(addTime()).toBeInTheDocument();
    expect(field()).toHaveValue("Saturday");
  });

  it("shows a time typed into the date field", () => {
    render(<Harness />);
    type("11/14 5pm");
    expect(time()).toHaveValue("17:00");
  });

  it("says when the form was submitted with a time already gone by", () => {
    render(<Harness initial="2026-11-09T09:00" passed />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That time has already passed.",
    );
  });
});

describe("dueEntryPassed", () => {
  it("refuses a new time already gone by, never a task's own", () => {
    expect(dueEntryPassed("2026-11-09T09:00", NOW)).toBe(true);
    expect(dueEntryPassed("2026-11-09T13:00", NOW)).toBe(false);
    expect(dueEntryPassed("2026-11-09", NOW)).toBe(false);
    expect(dueEntryPassed("2026-11-09T09:00", NOW, "2026-11-09T09:00")).toBe(
      false,
    );
  });
});

describe("DueDateField withoutTime", () => {
  it("offers no time for a due that is only a day", () => {
    render(
      <DueDateField
        aria-label="Due date"
        now={NOW}
        withoutTime
        value="2026-11-14"
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add a time" })).toBeNull();
  });
});
