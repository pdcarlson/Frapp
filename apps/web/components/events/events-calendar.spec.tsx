import { fireEvent, render, screen } from "@testing-library/react";
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
      canCreate
      chapterHasEvents
      createDisabled={false}
    />,
  );
}

// A chapter with no events, on this month, so today is in the grid.
function renderEmptyCalendar(canCreate: boolean) {
  const onCreateOnDay = vi.fn();
  const view = render(
    <EventsCalendar
      events={[]}
      monthAnchor={startOfMonth(new Date())}
      onMonthAnchorChange={vi.fn()}
      onSelectEvent={vi.fn()}
      onCreateOnDay={onCreateOnDay}
      canCreate={canCreate}
      chapterHasEvents={false}
      createDisabled={false}
    />,
  );
  return { ...view, onCreateOnDay };
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

  it("says how to make the first event, and puts a + on today", () => {
    const { onCreateOnDay } = renderEmptyCalendar(true);

    expect(
      screen.getByText("Pick a day to schedule the first event."),
    ).toBeInTheDocument();
    const slot = screen.getByTestId("calendar-first-event-slot");
    // A pointer target only: the day number is the keyboard's way in.
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveAttribute("tabindex", "-1");
    fireEvent.click(slot);
    expect(onCreateOnDay).toHaveBeenCalledTimes(1);
    const day = onCreateOnDay.mock.calls[0]![0] as Date;
    expect(day.toDateString()).toBe(new Date().toDateString());
  });

  it("gives a member the dates as text, with no create and no +", () => {
    renderEmptyCalendar(false);

    expect(
      screen.getByText("Nothing on the calendar yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^create event on/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-first-event-slot"),
    ).not.toBeInTheDocument();
  });

  it("drops the line and the + once the chapter has an event", () => {
    renderCalendar();

    expect(
      screen.queryByText("Pick a day to schedule the first event."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-first-event-slot"),
    ).not.toBeInTheDocument();
  });
});
