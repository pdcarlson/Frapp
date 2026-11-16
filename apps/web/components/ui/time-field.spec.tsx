import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeField, durationLabel } from "./time-field";

function Harness({ initial = "", from }: { initial?: string; from?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="t">Started</label>
      <TimeField id="t" value={value} onChange={setValue} from={from} />
      <output>{value || "none"}</output>
    </>
  );
}

/** The typed time field that replaced the browser's spinner (#5219). */
describe("TimeField", () => {
  it("reads a typed time and writes it out on leaving", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Started");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "7" } });
    expect(screen.getByRole("status")).toHaveTextContent("19:00");
    fireEvent.blur(field);
    expect(field).toHaveValue("7 PM");
  });

  it("picks a time from the quarter-hour list", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Started");
    fireEvent.pointerDown(field);
    fireEvent.click(screen.getByRole("option", { name: "7:15 PM" }));
    expect(screen.getByRole("status")).toHaveTextContent("19:15");
    expect(field).toHaveValue("7:15 PM");
  });

  it("holds nothing while the text can't be read", () => {
    render(<Harness initial="19:00" />);
    const field = screen.getByLabelText("Started");
    fireEvent.change(field, { target: { value: "later" } });
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("says how long an end time runs", () => {
    expect(durationLabel("19:00", "19:30")).toBe("30 min");
    expect(durationLabel("19:00", "20:00")).toBe("1 hr");
    expect(durationLabel("19:00", "20:30")).toBe("1.5 hrs");
    expect(durationLabel("23:00", "00:30")).toBe("1.5 hrs");
  });
});
