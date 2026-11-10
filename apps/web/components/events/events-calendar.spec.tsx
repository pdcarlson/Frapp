import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("gives a creator whose days are off the fact, not the how", () => {
    // A lapsed chapter or an offline officer: every day is disabled, so
    // "Pick a day" would be an instruction nothing on the page can follow.
    render(
      <EventsCalendar
        events={[]}
        monthAnchor={startOfMonth(new Date())}
        onMonthAnchorChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateOnDay={vi.fn()}
        canCreate
        chapterHasEvents={false}
        createDisabled
      />,
    );

    expect(
      screen.getByText("Nothing on the calendar yet."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-first-event-slot")).toBeNull();
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
    // On this month, so today is in the grid and a + could be drawn on it.
    render(
      <EventsCalendar
        events={[
          { id: "evt-1", name: "Rush", start_time: new Date().toISOString() },
        ]}
        monthAnchor={startOfMonth(new Date())}
        onMonthAnchorChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateOnDay={vi.fn()}
        canCreate
        chapterHasEvents
        createDisabled={false}
      />,
    );

    expect(
      screen.queryByText("Pick a day to schedule the first event."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-first-event-slot"),
    ).not.toBeInTheDocument();
  });
});

/**
 * A `ResizeObserver` that reports `width` as soon as it observes, standing in
 * for a calendar beside chat (#4022). The suite's setup stub never fires, so
 * every other test draws the full month.
 */
function stubCalendarWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

describe("EventsCalendar on a narrow page (#4022)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the full month, names on the grid, when the page is wide", () => {
    stubCalendarWidth(900);
    renderCalendar();

    expect(
      screen.getByRole("button", { name: /^view chapter meeting/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^november 6, 1 event$/i }),
    ).not.toBeInTheDocument();
  });

  it("goes compact at 480px: days carry counts, the picked day lists its events", () => {
    stubCalendarWidth(480);
    const onSelectEvent = vi.fn();
    const onCreateOnDay = vi.fn();
    render(
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
        onSelectEvent={onSelectEvent}
        onCreateOnDay={onCreateOnDay}
        canCreate
        chapterHasEvents
        createDisabled={false}
      />,
    );

    // No event name on the grid: the day says how many.
    expect(
      screen.queryByRole("button", { name: /^view chapter meeting/i }),
    ).not.toBeInTheDocument();
    const day = screen.getByRole("button", { name: "November 6, 1 event" });
    expect(day).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(day);
    expect(day).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: /November 6/ }),
    ).toBeInTheDocument();

    // The event opens from the day's list, by its full name.
    fireEvent.click(
      screen.getByRole("button", {
        name: /^View Chapter Meeting, 5:00\sPM, mandatory$/,
      }),
    );
    expect(onSelectEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-1" }),
    );

    // Creating on a day is still one press away, on the picked day.
    fireEvent.click(
      screen.getByRole("button", { name: /^New event on .*November 6/ }),
    );
    const created = onCreateOnDay.mock.calls[0]?.[0] as Date;
    expect(created.getDate()).toBe(6);
    expect(created.getMonth()).toBe(10);
  });

  it("offers no New event to a viewer who cannot create", () => {
    stubCalendarWidth(480);
    render(
      <EventsCalendar
        events={[]}
        monthAnchor={anchor}
        onMonthAnchorChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateOnDay={vi.fn()}
        canCreate={false}
        chapterHasEvents={false}
        createDisabled={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^New event on/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Nothing on this day.")).toBeInTheDocument();
  });
});
