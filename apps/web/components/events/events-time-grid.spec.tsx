import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_KIND_HUE } from "@repo/hooks/activity-agenda";
import { selectCalendarBirthdays } from "@repo/hooks/calendar-birthdays";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  selectCalendarTasks,
} from "@repo/hooks/calendar-tasks";
import { consecutiveDays } from "@repo/hooks/calendar-time-grid";
import { attendanceFieldsOf } from "@repo/validation";
import { calendarEventFacts, EventsTimeGrid } from "./events-time-grid";

/*
 * The hour grid (#4818), reached from an agenda day's Hours since #5560:
 * a column per day, timed events as blocks, overlaps side by side, an All
 * day strip for long events, tasks and birthdays, the now line, and the
 * hours as a creator's way in. Coloured by kind like the agenda.
 */

// Tuesday, November 10, 2026, and the two days after it.
const tuesday = new Date(2026, 10, 10);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

const events = [
  {
    id: "meeting",
    name: "Chapter Meeting",
    start_time: at(12, 18),
    end_time: at(12, 20),
    is_mandatory: true,
  },
  {
    id: "dinner",
    name: "Alumni Dinner",
    start_time: at(12, 19),
    end_time: at(12, 21),
  },
  {
    id: "retreat",
    name: "Retreat",
    start_time: at(10, 9),
    end_time: at(11, 12),
  },
];

const tasks = selectCalendarTasks(
  [
    {
      id: "task-1",
      title: "Dues form",
      assignee_id: "me",
      created_by: "officer",
      due_date: "2026-11-11",
      status: "TODO",
    },
    {
      id: "task-2",
      title: "Book the bus",
      assignee_id: "me",
      created_by: "officer",
      due_date: "2026-11-12",
      due_at: at(12, 18),
      status: "TODO",
    },
  ],
  "me",
);
const birthdays = selectCalendarBirthdays(
  [
    {
      id: "u-dana",
      display_name: "Dana Lowe",
      avatar_url: null,
      birthday_month: 11,
      birthday_day: 11,
    },
  ],
  [2026],
);

const requiredOf = (fields: ReturnType<typeof attendanceFieldsOf>) =>
  fields.is_mandatory === true;

function renderGrid({
  days = 3,
  canCreate = true,
  createDisabled = false,
}: { days?: number; canCreate?: boolean; createDisabled?: boolean } = {}) {
  const handlers = {
    onSelectEvent: vi.fn(),
    onCreateAt: vi.fn(),
    onOpenDay: vi.fn(),
  };
  render(
    <EventsTimeGrid
      days={consecutiveDays(tuesday, days)}
      events={events}
      tasksByDay={calendarTasksByDay(
        [...tasks, ...birthdays],
        ALL_CALENDAR_LAYERS,
      )}
      nameOf={() => "A member"}
      factsOf={(event) => calendarEventFacts(event, requiredOf)}
      canCreate={canCreate}
      createDisabled={createDisabled}
      {...handlers}
    />,
  );
  return handlers;
}

describe("EventsTimeGrid", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws overlapping events side by side in equal lanes", () => {
    renderGrid();
    const thursday = screen.getByTestId("time-grid-day-2026-11-12");
    const meeting = within(thursday).getByRole("button", {
      name: /View Chapter Meeting/,
    });
    const dinner = within(thursday).getByRole("button", {
      name: /View Alumni Dinner/,
    });
    expect(meeting.style.width).toBe("calc(50% - 4px)");
    expect(meeting.style.left).toBe("calc(0% + 2px)");
    expect(dinner.style.left).toBe("calc(50% + 2px)");
    // 6 PM on 48px hours, two hours tall.
    expect(meeting.style.top).toBe(`${18 * 48}px`);
    expect(meeting.style.height).toBe(`${2 * 48 - 1}px`);
  });

  it("puts a long event, the day's tasks and its birthdays in the All day strip", () => {
    renderGrid();
    expect(screen.getByText("All day")).toBeInTheDocument();
    for (const chip of screen.getAllByRole("button", {
      name: /View Retreat/,
    })) {
      expect(chip.style.top).toBe("");
    }
    expect(screen.getByText("Dues form")).toBeInTheDocument();
    expect(screen.getByTitle("Dana Lowe's birthday")).toBeInTheDocument();
  });

  it("puts a task due at a time in the hour grid at that time, beside the event then (#5116)", () => {
    renderGrid();
    const thursday = screen.getByTestId("time-grid-day-2026-11-12");
    const marker = within(thursday).getByRole("button", {
      name: "Book the bus, due 6 PM, your task, to do",
    });
    expect(marker).toHaveTextContent("6 PM");
    // At 6 PM, half an hour tall, beside the meeting; the 7 PM dinner
    // takes its lane once it has passed.
    expect(marker.style.top).toBe(`${18 * 48}px`);
    expect(marker.style.height).toBe(`${24 - 1}px`);
    expect(marker.style.left).toBe("calc(50% + 2px)");
    expect(marker.style.width).toBe("calc(50% - 4px)");
    const meeting = within(thursday).getByRole("button", {
      name: /View Chapter Meeting/,
    });
    expect(meeting.style.width).toBe("calc(50% - 4px)");
  });

  it("shows a multi-day event on every day it covers", () => {
    renderGrid();
    // Retreat runs Tue Nov 10, 9 AM to Wed Nov 11, noon.
    expect(
      screen.getAllByRole("button", { name: /View Retreat/ }),
    ).toHaveLength(2);
  });

  it("draws the now line at the time, in today's column only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 16, 30));
    renderGrid();
    const today = screen.getByTestId("time-grid-day-2026-11-11");
    expect(within(today).getByTestId("time-grid-now").style.top).toBe(
      `${16.5 * 48 - 1}px`,
    );
    expect(screen.getAllByTestId("time-grid-now")).toHaveLength(1);
  });

  it("gives a viewer who can't create no hour buttons", () => {
    renderGrid({ canCreate: false });
    expect(
      screen.queryByRole("button", { name: /Create event on/ }),
    ).toBeNull();
  });

  it("keeps a day's hours as the keyboard path: several days open one from its heading", () => {
    const { onOpenDay, onCreateAt } = renderGrid();
    // Three days: the slots stay out of the tab order...
    const slot = screen.getAllByRole("button", { name: /Create event on/ })[0]!;
    expect(slot).toHaveAttribute("tabindex", "-1");
    // ...and each heading opens its day alone.
    fireEvent.click(
      screen.getByRole("button", { name: "Open Wednesday, November 11" }),
    );
    expect(onOpenDay).toHaveBeenCalledWith(new Date(2026, 10, 11));

    // One day: its hours are tabbable and make an event at that hour.
    document.body.innerHTML = "";
    const single = renderGrid({ days: 1 });
    const threePm = screen.getByRole("button", {
      name: /Create event on Tuesday, November 10 at 3\sPM/,
    });
    expect(threePm).not.toHaveAttribute("tabindex");
    fireEvent.click(threePm);
    expect(single.onCreateAt).toHaveBeenCalledWith(tuesday, 15);
    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("disables the hours while creating is off", () => {
    renderGrid({ days: 1, createDisabled: true });
    for (const slot of screen.getAllByRole("button", {
      name: /Create event on/,
    })) {
      expect(slot).toBeDisabled();
    }
  });

  it("colours by kind: sky events, the loud required treatment, green tasks, rose birthdays", () => {
    renderGrid();
    const meeting = screen.getByRole("button", {
      name: /View Chapter Meeting/,
    });
    const dinner = screen.getByRole("button", { name: /View Alumni Dinner/ });
    expect(meeting).toHaveAttribute("data-required", "true");
    expect(meeting.getAttribute("style")).toContain("22%");
    expect(dinner.getAttribute("style")).toContain("9%");
    // Never the accent, which marks today.
    expect(meeting.className).not.toContain("border-l-primary");

    const task = screen.getByRole("button", { name: /Dues form, your task/ });
    expect(within(task).getByTestId("agenda-mark")).toHaveAttribute(
      "data-hue",
      CALENDAR_KIND_HUE.tasks,
    );
    const birthday = screen.getByTitle("Dana Lowe's birthday");
    expect(within(birthday).getByTestId("agenda-mark")).toHaveAttribute(
      "data-hue",
      CALENDAR_KIND_HUE.birthdays,
    );
  });
});
