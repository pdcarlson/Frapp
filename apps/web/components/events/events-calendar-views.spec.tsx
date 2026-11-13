import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  selectCalendarTasks,
} from "@repo/hooks/calendar-tasks";
import type { CalendarView } from "@/lib/events/events-view";
import { EventsCalendar } from "./events-calendar";

vi.mock("@repo/hooks", () => ({
  useRequiredOfViewer: () => (fields: { is_mandatory?: boolean | null }) =>
    fields.is_mandatory === true,
}));

// Friday, November 13, 2026; its week runs Sunday the 8th to Saturday the 14th.
const friday = new Date(2026, 10, 13);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

const events = [
  {
    id: "meeting",
    name: "Chapter Meeting",
    start_time: at(13, 18),
    end_time: at(13, 20),
  },
  {
    id: "dinner",
    name: "Alumni Dinner",
    start_time: at(13, 19),
    end_time: at(13, 21),
  },
  {
    id: "retreat",
    name: "Retreat",
    start_time: at(10, 9),
    end_time: at(11, 12),
  },
];

function renderViews({
  view,
  canCreate = true,
}: {
  view: CalendarView;
  canCreate?: boolean;
}) {
  const handlers = {
    onAnchorChange: vi.fn(),
    onViewChange: vi.fn(),
    onCreateOnDay: vi.fn(),
    onSelectEvent: vi.fn(),
  };
  const tasks = selectCalendarTasks(
    [
      {
        id: "task-1",
        title: "Dues form",
        assignee_id: "me",
        created_by: "officer",
        due_date: "2026-11-12",
        status: "TODO",
        stored_status: "TODO",
        points_awarded: false,
        confirmed_at: null,
      },
    ],
    "me",
  );
  render(
    <EventsCalendar
      events={events}
      anchor={friday}
      view={view}
      canCreate={canCreate}
      chapterHasEvents
      createDisabled={false}
      tasksByDay={calendarTasksByDay(tasks, ALL_CALENDAR_LAYERS)}
      {...handlers}
    />,
  );
  return handlers;
}

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

describe("EventsCalendar Week and Day (#4818)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws the week from its Sunday, with overlapping events side by side", () => {
    renderViews({ view: "week" });
    expect(
      screen.getByRole("heading", { name: /Nov 8.*14, 2026/ }),
    ).toBeInTheDocument();
    for (const day of ["08", "09", "10", "11", "12", "13", "14"]) {
      expect(screen.getByTestId(`time-grid-day-2026-11-${day}`)).toBeTruthy();
    }
    const friday = screen.getByTestId("time-grid-day-2026-11-13");
    const meeting = within(friday).getByRole("button", {
      name: /View Chapter Meeting/,
    });
    const dinner = within(friday).getByRole("button", {
      name: /View Alumni Dinner/,
    });
    // Two lanes: each half the column, the later one on the right.
    expect(meeting.style.width).toBe("calc(50% - 4px)");
    expect(meeting.style.left).toBe("calc(0% + 2px)");
    expect(dinner.style.left).toBe("calc(50% + 2px)");
    // 6 PM on 48px hours, two hours tall.
    expect(meeting.style.top).toBe(`${18 * 48}px`);
    expect(meeting.style.height).toBe(`${2 * 48 - 1}px`);
  });

  it("puts a day-long event and the day's tasks in the all-day strip", () => {
    renderViews({ view: "week" });
    expect(screen.getByText("All day")).toBeInTheDocument();
    // In the strip, not placed on the hours.
    for (const chip of screen.getAllByRole("button", {
      name: /View Retreat/,
    })) {
      expect(chip.style.top).toBe("");
    }
    expect(screen.getByText("Dues form")).toBeInTheDocument();
  });

  it("opens a day from its heading in the Day view", () => {
    const { onAnchorChange, onViewChange } = renderViews({ view: "week" });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Wednesday, November 11" }),
    );
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 10, 11));
    expect(onViewChange).toHaveBeenCalledWith("day");
  });

  it("steps a week at a time", () => {
    const { onAnchorChange } = renderViews({ view: "week" });
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 10, 6));
  });

  it("creates an event at the hour an officer presses in the Day view", () => {
    const { onCreateOnDay } = renderViews({ view: "day" });
    expect(
      screen.getByRole("heading", { name: "Friday, November 13, 2026" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Create event on Friday, November 13 at 3\sPM/,
      }),
    );
    expect(onCreateOnDay).toHaveBeenCalledWith(friday, 15);
  });

  it("gives a member who can't create no hour buttons", () => {
    renderViews({ view: "day", canCreate: false });
    expect(
      screen.queryByRole("button", { name: /Create event on/ }),
    ).not.toBeInTheDocument();
  });

  it("switches views from the Month / Week / Day control", () => {
    const { onViewChange } = renderViews({ view: "week" });
    const control = screen.getByRole("radiogroup", { name: "Calendar view" });
    fireEvent.click(within(control).getByRole("radio", { name: "Month" }));
    expect(onViewChange).toHaveBeenCalledWith("month");
  });

  it("draws three days from the anchor beside chat", () => {
    stubCalendarWidth(480);
    const { onAnchorChange } = renderViews({ view: "week" });
    expect(screen.getByRole("radio", { name: "3 days" })).toBeChecked();
    expect(screen.getByTestId("time-grid-day-2026-11-13")).toBeTruthy();
    expect(screen.getByTestId("time-grid-day-2026-11-15")).toBeTruthy();
    expect(screen.queryByTestId("time-grid-day-2026-11-12")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next 3 days" }));
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 10, 16));
  });
});

describe("Week and Day details (#4818)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a multi-day event on every day it covers", () => {
    renderViews({ view: "week" });
    // Retreat runs Tue Nov 10, 9 AM to Wed Nov 11, noon.
    expect(
      screen.getAllByRole("button", { name: /View Retreat/ }),
    ).toHaveLength(2);
  });

  it("disables the hours while creating is off", () => {
    render(
      <EventsCalendar
        events={[]}
        anchor={friday}
        onAnchorChange={vi.fn()}
        view="day"
        onViewChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateOnDay={vi.fn()}
        canCreate
        chapterHasEvents
        createDisabled
      />,
    );
    for (const slot of screen.getAllByRole("button", {
      name: /Create event on/,
    })) {
      expect(slot).toBeDisabled();
    }
  });

  it("tells a creator with no events to press an hour", () => {
    render(
      <EventsCalendar
        events={[]}
        anchor={friday}
        onAnchorChange={vi.fn()}
        view="week"
        onViewChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onCreateOnDay={vi.fn()}
        canCreate
        chapterHasEvents={false}
        createDisabled={false}
      />,
    );
    expect(
      screen.getByText("Press an hour to schedule the first event."),
    ).toBeInTheDocument();
  });

  it("draws the now line at the time in today's column", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 13, 16, 30));
    renderViews({ view: "week" });
    const today = screen.getByTestId("time-grid-day-2026-11-13");
    const line = within(today).getByTestId("time-grid-now");
    expect(line.style.top).toBe(`${16.5 * 48 - 1}px`);
    expect(screen.getAllByTestId("time-grid-now")).toHaveLength(1);
  });

  it("keeps the week it was on across Month and back", () => {
    // Week → Month → Week: switching views never moves the anchor.
    const { onAnchorChange, onViewChange } = renderViews({ view: "week" });
    const control = screen.getByRole("radiogroup", { name: "Calendar view" });
    fireEvent.click(within(control).getByRole("radio", { name: "Month" }));
    expect(onViewChange).toHaveBeenCalledWith("month");
    expect(onAnchorChange).not.toHaveBeenCalled();
  });
});
