import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { EventsCalendar, startOfMonth } from "./events-calendar";

// Local wall-clock parts, so the event lands in the anchor month's grid in any
// zone the suite runs in.
const anchor = startOfMonth(new Date(2026, 10, 1));
const start = new Date(2026, 10, 6, 17, 0).toISOString();

function renderCalendar() {
  return render(
    <EventsCalendar
      events={[
        {
          id: "evt-1",
          name: "Chapter Meeting",
          start_time: start,
          is_mandatory: true,
        },
      ]}
      monthAnchor={anchor}
      onMonthAnchorChange={vi.fn()}
      onSelectEvent={vi.fn()}
      onCreateOnDay={vi.fn()}
      createDisabled={false}
    />,
  );
}

describe("EventsCalendar", () => {
  it("names a chip by its time of day alone, since the cell carries the day", () => {
    renderCalendar();

    const chip = screen.getByRole("button", { name: /^view chapter meeting/i });
    expect(chip).toHaveAccessibleName(
      /^View Chapter Meeting, 5:00\sPM, mandatory$/,
    );
  });

  it("titles itself by month and paints no card", () => {
    const { container } = renderCalendar();

    expect(
      screen.getByRole("heading", { name: "November 2026" }),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });
});
