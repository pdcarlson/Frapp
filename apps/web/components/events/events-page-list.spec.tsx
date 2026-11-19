import { act, render, screen, within } from "@testing-library/react";
import { selectCalendarBirthdays } from "@repo/hooks/calendar-birthdays";
import { selectCalendarTasks } from "@repo/hooks/calendar-tasks";
import { CALENDAR_KIND_HUE } from "@repo/hooks/activity-agenda";
import { localIsoDate } from "@repo/formatting";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardFilledContainers } from "@/tests/card-surfaces";

/*
 * The Events agenda (#5560, `spec/ui/web-dashboard/README.md` § Chapter ops):
 * no wrapper card or table, a section label that follows the Time filter,
 * days under written-out headings holding events, tasks and birthdays in
 * their kinds' hues, one row per repeating series, a navigator and a colour
 * key that is the filter, the filters behind one Filter button, bulk
 * selection behind Select, and no badge or meta clause standing in for an
 * absent value (#3822).
 */

const DAY = 24 * 60 * 60 * 1000;
// Relative to the suite's clock, so the rows sit inside the two-week horizon
// whenever it runs. Local noon two and three days out.
function daysOut(days: number, hour = 12): string {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return new Date(at.getTime() + days * DAY).toISOString();
}

const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter Meeting",
    location: "Great Hall",
    start_time: daysOut(2),
    end_time: daysOut(2, 13),
    is_mandatory: true,
    point_value: 5,
    recurrence_rule: "WEEKLY",
    parent_event_id: null,
  },
  {
    id: "evt-2",
    name: "Study Night",
    location: null,
    start_time: daysOut(3),
    end_time: daysOut(3, 14),
    is_mandatory: false,
    point_value: 0,
    recurrence_rule: null,
    parent_event_id: null,
  },
];

// A weekly series of 13 meetings, its head two days out: the shape the API
// stores (the rule on the head, the rest pointing at it).
function weeklySeries(name: string, count = 13) {
  return Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? "series-head" : `series-${i}`,
    name,
    location: null,
    start_time: daysOut(2 + i * 7, 18),
    end_time: daysOut(2 + i * 7, 19),
    is_mandatory: true,
    point_value: 0,
    recurrence_rule: i === 0 ? "WEEKLY" : null,
    parent_event_id: i === 0 ? null : "series-head",
  }));
}

const eventsQuery: { data: unknown; isError?: boolean } = { data: EVENTS };
type AttendanceFields = { is_mandatory?: boolean | null };
// A viewer with no roles: the event's default decides.
const byDefault = (fields: AttendanceFields) => fields.is_mandatory === true;
const requiredOfViewer: { current: (fields: AttendanceFields) => boolean } = {
  current: byDefault,
};
const permissionsRef: { current: string[] } = {
  current: ["events:create", "events:update", "members:view"],
};

// "This time last year" (#3930) has its own spec.
vi.mock("@/components/ai/suggested-events", () => ({
  SuggestedEvents: () => null,
  useRecordPlannedEvent: () => async () => undefined,
}));

vi.mock("@repo/hooks", async () => {
  const { eventsPageHooks, eventTypeHooks } =
    await import("@/tests/events-page");
  return eventsPageHooks({
    // The rule itself is the hook's own spec; here the page has to follow
    // whatever it answers (#4132).
    useRequiredOfViewer: () => requiredOfViewer.current,
    useCalendarBirthdays: () => birthdaysRef.current,
    useCalendarTasks: () => tasksRef.current,
    useRoles: () => ({ data: [], isError: false }),
    // The editor itself, opened by the draft cases (#4593).
    ...eventTypeHooks([]),
    useEvents: () => ({
      data: eventsQuery.data,
      isLoading: false,
      isError: eventsQuery.isError ?? false,
      error: eventsQuery.isError ? new Error("boom") : null,
      refetch: vi.fn(),
    }),
    useMyPermissions: () => ({
      data: { permissions: permissionsRef.current },
      isLoading: false,
    }),
  });
});

// The viewer whose last view (List or Calendar) the page reads; no stored
// choice unless a test writes one.
const { viewerRef } = vi.hoisted(() => ({
  viewerRef: {
    current: { userId: "user-1", isLoading: false } as {
      userId: string | null;
      isLoading: boolean;
    },
  },
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => viewerRef.current,
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

const { detailSheetProps } = vi.hoisted(() => ({
  detailSheetProps: vi.fn(),
}));
vi.mock("./event-detail-sheet", () => ({
  EventDetailSheet: (props: {
    open: boolean;
    event: unknown;
    series?: unknown;
    seriesRule?: unknown;
    onSelectOccurrence?: (event: unknown) => void;
  }) => {
    detailSheetProps(props);
    return null;
  },
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

// The page's URL; no `?event=` unless a test sets one.
const searchRef = vi.hoisted(() => ({ current: new URLSearchParams() }));
// The agenda's birthday items (#4959), as `useCalendarBirthdays` serves them.
const birthdaysRef = vi.hoisted(() => ({
  current: [] as import("@repo/hooks/calendar-birthdays").CalendarBirthday[],
}));
// The agenda's tasks (#4144), as `useCalendarTasks` serves them.
const tasksRef = vi.hoisted(() => ({
  current: {
    items: [] as import("@repo/hooks/calendar-tasks").CalendarTask[],
    hasMine: false,
    hasAssigned: false,
  },
}));
// The pane's measured width: `null` (unmeasured, as in jsdom) draws the wide
// layout; a test sets `true` for the narrow one beside chat.
const narrowRef = vi.hoisted(() => ({ current: null as boolean | null }));
vi.mock("@/lib/use-is-narrow", () => ({
  useIsNarrow: () => [() => undefined, narrowRef.current],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchRef.current,
}));

import { EventsPage } from "./events-page";

const row = (name: RegExp) => {
  const button = screen.getByRole("button", { name });
  const item = button.closest("li");
  if (!item) throw new Error("row is not a list item");
  return item;
};

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^filter events/i }));
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  group: string,
  option: string,
) {
  await user.click(
    within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: option,
    }),
  );
}

beforeEach(() => {
  requiredOfViewer.current = byDefault;
  vi.clearAllMocks();
  window.localStorage.clear();
  viewerRef.current = { userId: "user-1", isLoading: false };
  eventsQuery.data = EVENTS;
  eventsQuery.isError = false;
  permissionsRef.current = ["events:create", "events:update", "members:view"];
  searchRef.current = new URLSearchParams();
  birthdaysRef.current = [];
  tasksRef.current = { items: [], hasMine: false, hasAssigned: false };
  narrowRef.current = null;
});

describe("EventsPage ?event=<id> (Activity's Open in Events, #3897)", () => {
  it("opens that event's detail sheet", () => {
    searchRef.current = new URLSearchParams({ event: "evt-2" });
    render(<EventsPage />);

    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        event: expect.objectContaining({ id: "evt-2" }),
      }),
    );
  });

  it("opens nothing for an id the list does not hold", () => {
    searchRef.current = new URLSearchParams({ event: "gone" });
    render(<EventsPage />);

    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );
  });
});

describe("EventsPage list", () => {
  it("draws no card container and no table", () => {
    const { container } = render(<EventsPage />);

    expect(cardFilledContainers(container)).toEqual([]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Upcoming" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("drops the narration the card carried", () => {
    render(<EventsPage />);

    expect(screen.queryByText(/upcoming & recent events/i)).toBeNull();
    expect(
      screen.queryByText(/attendance windows and point values/i),
    ).toBeNull();
  });

  it("keeps the toolbar to search, one Filter button and a quiet New event, with no switcher", () => {
    const { container } = render(<EventsPage />);

    // The route's h1 is the top bar's (`top-bar.tsx`), not the page's.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    const newEvent = screen.getByRole("button", { name: /new event/i });
    const toolbarRow = newEvent.parentElement;
    expect(toolbarRow).toBeTruthy();
    const scope = within(toolbarRow as HTMLElement);
    expect(
      scope.getByRole("searchbox", { name: /search events/i }),
    ).toBeInTheDocument();
    expect(
      scope.getByRole("button", { name: "Filter events" }),
    ).toBeInTheDocument();
    // No List | Calendar, no Month | Week | Day, no chip row (#5560).
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "My tasks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assigned by me" })).toBeNull();
    // Still the one primary action, outlined in the accent, not filled.
    expect(newEvent.className).toContain("border-primary/35");
    expect(newEvent.className).toContain("text-primary");
    expect(newEvent.className).not.toMatch(/(^| )bg-primary( |$)/);
    // No native select anywhere on the page (#3822).
    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("holds Time, Attendance and Cadence in the Filter popover, counts what's on, and clears it", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "All");
    await pick(user, "Attendance", "Mandatory");

    expect(
      screen.getByRole("button", { name: "Filter events, 2 on" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "All events" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("button", { name: "Filter events" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Upcoming" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("groups rows under written-out day headings, Today always first", () => {
    render(<EventsPage />);

    const meetingDay = new Date(EVENTS[0]!.start_time).toLocaleDateString(
      undefined,
      { weekday: "long" },
    );
    expect(
      screen.getByRole("heading", { level: 3, name: meetingDay }),
    ).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent("Today");
    expect(screen.getByText("Nothing today.")).toBeInTheDocument();
  });

  it("shows a repeating series once, as its next meeting, saying how it repeats", async () => {
    const user = userEvent.setup();
    eventsQuery.data = weeklySeries("Chapter");
    render(<EventsPage />);

    expect(screen.getAllByRole("button", { name: /^chapter/i })).toHaveLength(
      1,
    );
    expect(screen.getByText("1 event")).toBeInTheDocument();
    const weekday = new Date(daysOut(2, 18)).toLocaleDateString("en-US", {
      weekday: "long",
    });
    expect(row(/^chapter/i).textContent).toContain(`Every ${weekday}`);

    // Opening it opens that meeting, with the series to list under it.
    await user.click(screen.getByRole("button", { name: /^chapter/i }));
    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        event: expect.objectContaining({ id: "series-head" }),
        series: expect.arrayContaining([
          expect.objectContaining({ id: "series-12" }),
        ]),
      }),
    );
  });

  it("files a generated meeting as repeating under the Cadence filter", async () => {
    const user = userEvent.setup();
    // The head has already happened: only generated meetings are upcoming,
    // and they carry no rule of their own.
    const series = weeklySeries("Chapter", 3).map((event, i) => ({
      ...event,
      start_time: daysOut(-7 + i * 7, 18),
    }));
    eventsQuery.data = series;
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Cadence", "Repeating");
    expect(screen.getByText("1 event")).toBeInTheDocument();
    await pick(user, "Cadence", "One-time");
    expect(
      screen.getByText(/^No events match these filters\./),
    ).toBeInTheDocument();
  });

  it("reaches four weeks out, and Show more reaches past them", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [
      EVENTS[1],
      { ...EVENTS[0], id: "far", name: "Formal", start_time: daysOut(40) },
    ];
    render(<EventsPage />);

    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^formal/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      screen.getByRole("button", { name: /^formal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says Nothing this week over a quiet week, then carries on to what comes after", () => {
    eventsQuery.data = [{ ...EVENTS[1], start_time: daysOut(10) }];
    render(<EventsPage />);

    expect(screen.getByText("Nothing today.")).toBeInTheDocument();
    expect(screen.getByText("Nothing this week.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^study night/i }),
    ).toBeInTheDocument();
  });

  it("carries on past the four weeks to the next day that has anything", () => {
    eventsQuery.data = [{ ...EVENTS[1], start_time: daysOut(60) }];
    render(<EventsPage />);

    expect(screen.getByText("Nothing this week.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^study night/i }),
    ).toBeInTheDocument();
  });

  it("marks and filters Required by what the event asks of this viewer, not its default (#4132)", async () => {
    // A viewer whose roles turn both defaults around: Study Night (optional
    // for everyone) is required of them, Chapter Meeting (required by
    // default) isn't.
    requiredOfViewer.current = (fields) => fields.is_mandatory !== true;
    const user = userEvent.setup();
    render(<EventsPage />);

    expect(
      within(row(/study night/i)).getByText("Required"),
    ).toBeInTheDocument();
    expect(
      within(row(/chapter meeting/i)).queryByText("Required"),
    ).not.toBeInTheDocument();

    await openFilters(user);
    await pick(user, "Attendance", "Mandatory");
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(row(/study night/i)).toBeInTheDocument();
  });

  it("draws a required event loudest: a fuller sky fill, a sky edge and the word Required", () => {
    render(<EventsPage />);

    const meeting = screen.getByRole("button", { name: /^chapter meeting/i });
    const study = screen.getByRole("button", { name: /^study night/i });
    expect(meeting).toHaveAttribute("data-required", "true");
    expect(study).not.toHaveAttribute("data-required");
    const required = within(meeting).getByText("Required");
    // The events hue, never the accent or red; the grey pill is gone.
    expect(required.getAttribute("style")).toContain("color");
    expect(required.className).not.toContain("text-destructive-text");
    expect(within(meeting).queryByText("Mandatory")).toBeNull();
    expect(within(meeting).queryByText("WEEKLY")).toBeNull();
  });

  it("leaves an absent value absent: no Optional badge, no TBD, no 0 points", () => {
    render(<EventsPage />);

    const study = row(/study night/i);
    expect(within(study).queryByText("Optional")).toBeNull();
    expect(within(study).queryByText("One-time")).toBeNull();
    expect(study.textContent).not.toMatch(/TBD|0 points/);
  });

  it("prints the when in a house shape, without seconds or a numeric date", () => {
    render(<EventsPage />);

    const text = row(/chapter meeting/i).textContent ?? "";
    expect(text).toContain("Great Hall");
    expect(text).toContain("5 points");
    expect(text).toContain("12:00 PM");
    expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(text).not.toMatch(/:\d\d:\d\d/);
  });

  it("opens the details from the row itself", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: /chapter meeting/i }));

    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        event: expect.objectContaining({ id: "evt-1" }),
      }),
    );
  });

  it("opens another meeting from the sheet's series list, with the series' rule", async () => {
    const user = userEvent.setup();
    // The head met six days ago, so the row opens a generated meeting (a
    // day out, whatever the hour the suite runs), which carries no rule of
    // its own.
    eventsQuery.data = weeklySeries("Chapter", 4).map((event, i) => ({
      ...event,
      start_time: daysOut(-6 + i * 7, 18),
    }));
    render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: /^chapter/i }));
    const props = detailSheetProps.mock.lastCall![0];
    expect(props.event).toEqual(expect.objectContaining({ id: "series-1" }));
    expect(props.seriesRule).toBe("WEEKLY");
    expect((props.series as { id: string }[]).map((event) => event.id)).toEqual(
      ["series-1", "series-2", "series-3"],
    );

    act(() => props.onSelectOccurrence!({ id: "series-3" }));
    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ id: "series-3" }),
      }),
    );
  });

  it("keeps the open sheet's series live as the events change", async () => {
    const user = userEvent.setup();
    const series = weeklySeries("Chapter", 4);
    eventsQuery.data = series;
    const { rerender } = render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: /^chapter/i }));
    expect(
      (detailSheetProps.mock.lastCall![0].series as unknown[]).length,
    ).toBe(4);

    // Another officer cancels a meeting; realtime refetches the list.
    eventsQuery.data = series.filter((event) => event.id !== "series-2");
    rerender(<EventsPage />);
    expect(
      (detailSheetProps.mock.lastCall![0].series as { id: string }[]).map(
        (event) => event.id,
      ),
    ).toEqual(["series-head", "series-1", "series-3"]);
  });

  it("opens a past generated meeting with its series' rule", async () => {
    const user = userEvent.setup();
    eventsQuery.data = weeklySeries("Chapter", 3).map((event, i) => ({
      ...event,
      start_time: daysOut(-15 + i * 7, 18),
    }));
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "Past");
    await user.keyboard("{Escape}");
    await user.click(screen.getAllByRole("button", { name: /^chapter/i })[0]!);
    expect(detailSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ id: "series-2" }),
        seriesRule: "WEEKLY",
      }),
    );
  });

  it("counts Time on the Filter button", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "Past");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Filter events, 1 on" }),
    ).toBeInTheDocument();
  });

  it("selects only what's on screen: a row the colour key hides drops out", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: /select all visible events/i }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^events, \d/i }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    ).toBeDisabled();

    // Back on, the ticks come back with the rows.
    await user.click(screen.getByRole("button", { name: /^events, \d/i }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("keeps Select's Done when no row is on screen", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: /select study night/i }),
    );
    await user.click(screen.getByRole("button", { name: /^events, \d/i }));

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Out of the mode; with no row on screen there's nothing to Select.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.getByText("0 events")).toBeInTheDocument();
  });

  it("has no checkboxes until Select, and selecting moves nothing", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    expect(screen.queryByRole("checkbox")).toBeNull();
    const rowsBefore = screen
      .getAllByRole("listitem")
      .map((item) => item.children.length);

    await user.click(screen.getByRole("button", { name: "Select" }));
    // The selection column was already there: each row keeps its children,
    // and the list header keeps its place above the first day.
    expect(
      screen.getAllByRole("listitem").map((item) => item.children.length),
    ).toEqual(rowsBefore);

    await user.click(
      screen.getByRole("checkbox", { name: /select all visible events/i }),
    );
    expect(
      screen.getByRole("checkbox", { name: /select chapter meeting/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /select study night/i }),
    ).toBeChecked();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    // No strip mounts above the list: the header swaps in place.
    expect(screen.getByText("2 selected").closest("section")).toBe(
      screen.getByRole("region", { name: "Upcoming" }),
    );

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });
});

describe("EventsPage empty states", () => {
  it("says the time window is empty, not the chapter, and widens it", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "Past");
    await user.keyboard("{Escape}");

    // The section and its count stay; one line sits where the rows were.
    expect(screen.getByRole("region", { name: "Past" })).toBeInTheDocument();
    expect(screen.getByText("0 events")).toBeInTheDocument();
    expect(screen.getByText(/^No past events\./)).toBeInTheDocument();
    expect(screen.queryByText(/no events yet/i)).toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show all events" }));
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("clears the kind filters from their own miss", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Attendance", "Mandatory");
    await pick(user, "Cadence", "One-time");
    await user.keyboard("{Escape}");

    expect(
      screen.getByText(/^No events match these filters\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter events" }),
    ).toBeInTheDocument();
  });

  it("keeps Past when the miss's Clear filters clears the kind filters", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [
      ...EVENTS,
      { ...EVENTS[1], id: "past", name: "Retreat", start_time: daysOut(-3) },
    ];
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "Past");
    await pick(user, "Attendance", "Mandatory");
    await user.keyboard("{Escape}");
    expect(
      screen.getByText(/^No events match these filters\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("region", { name: "Past" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^retreat/i }),
    ).toBeInTheDocument();
  });

  it("names a search miss and clears it", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    const search = screen.getByRole("searchbox", { name: /search events/i });
    await user.type(search, "gala");

    expect(
      screen.getByText(/^No events match that search\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("shows a chapter with no events its agenda, on no card", () => {
    eventsQuery.data = [];
    const { container } = render(<EventsPage />);

    expect(screen.getByText("Nothing scheduled yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing today.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: /no events yet/i }),
    ).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says the phone's words when the events fail to load (#4135)", () => {
    eventsQuery.data = undefined;
    eventsQuery.isError = true;
    render(<EventsPage />);
    expect(screen.getByText("Couldn't load events")).toBeInTheDocument();
  });

  it("offers no create control to a role with events:create but not members:view, which the API refuses", () => {
    // `EVENT_CREATE_PERMISSIONS`: `POST /v1/events` needs both.
    permissionsRef.current = ["events:create"];
    eventsQuery.data = [];
    render(<EventsPage />);

    expect(screen.queryByRole("button", { name: /new event/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^create event on/i }),
    ).toBeNull();
  });

  it("gives a member the agenda without a create control", () => {
    permissionsRef.current = ["members:view"];
    eventsQuery.data = [];
    render(<EventsPage />);

    expect(screen.getByText("Nothing today.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new event/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^create event on/i }),
    ).toBeNull();
  });
});

describe("EventsPage agenda kinds, navigator and key (#5560)", () => {
  function withBirthdayToday() {
    const today = new Date();
    birthdaysRef.current = selectCalendarBirthdays(
      [
        {
          id: "u-dana",
          display_name: "Dana Lowe",
          avatar_url: null,
          birthday_month: today.getMonth() + 1,
          birthday_day: today.getDate(),
        },
      ],
      [today.getFullYear()],
    );
  }

  /** Tasks due today: one of the viewer's, one handed to three members. */
  function withTasksToday() {
    const due = localIsoDate(new Date());
    const base = { due_date: due, points_awarded: false, confirmed_at: null };
    const items = selectCalendarTasks(
      [
        {
          ...base,
          id: "t-mine",
          title: "Dues form",
          assignee_id: "user-1",
          created_by: "officer",
          status: "COMPLETED",
          points_awarded: true,
        },
        ...["m1", "m2", "m3"].map((member) => ({
          ...base,
          id: `t-${member}`,
          title: "Service log",
          assignee_id: member,
          created_by: "user-1",
          status: "TODO",
        })),
      ],
      "user-1",
    );
    tasksRef.current = { items, hasMine: true, hasAssigned: true };
  }

  const today = () => localIsoDate(new Date());
  const dayOf = (iso: string) => localIsoDate(new Date(iso));
  const markOf = (element: HTMLElement) =>
    within(element).getByTestId("agenda-mark").getAttribute("data-hue");
  const dotHue = (day: string, kind: string) =>
    screen.getByTestId(`events-dot-${day}-${kind}`).getAttribute("data-hue");

  it("interleaves a day's events, tasks and birthdays, events first", () => {
    withBirthdayToday();
    withTasksToday();
    eventsQuery.data = [{ ...EVENTS[1], start_time: new Date().toISOString() }];
    render(<EventsPage />);

    const todayGroup = screen.getByRole("group", { name: "Today" });
    const kinds = within(todayGroup)
      .getAllByRole("listitem")
      .map((item) =>
        item.querySelector("[data-kind]")?.getAttribute("data-kind"),
      );
    expect(kinds).toEqual(["events", "tasks", "tasks", "birthdays"]);
    expect(screen.queryByText("Nothing today.")).toBeNull();
  });

  it("colours each row as its day's dot and its key swatch", () => {
    withBirthdayToday();
    withTasksToday();
    render(<EventsPage />);

    const event = screen.getByRole("button", { name: /^study night/i });
    const eventDay = dayOf(EVENTS[1]!.start_time);
    expect(markOf(event)).toBe(CALENDAR_KIND_HUE.events);
    expect(dotHue(eventDay, "events")).toBe(CALENDAR_KIND_HUE.events);

    const task = screen.getByRole("button", { name: /^dues form/i });
    expect(markOf(task)).toBe(CALENDAR_KIND_HUE.tasks);
    expect(dotHue(today(), "tasks")).toBe(CALENDAR_KIND_HUE.tasks);

    const birthday = screen
      .getByText("Dana Lowe's birthday")
      .closest("[data-kind]") as HTMLElement;
    expect(markOf(birthday)).toBe(CALENDAR_KIND_HUE.birthdays);
    expect(dotHue(today(), "birthdays")).toBe(CALENDAR_KIND_HUE.birthdays);

    for (const kind of ["events", "tasks", "birthdays"] as const) {
      expect(
        screen
          .getByTestId(`events-key-swatch-${kind}`)
          .getAttribute("data-hue"),
      ).toBe(CALENDAR_KIND_HUE[kind]);
    }
    // Three different hues, none of them the same.
    expect(new Set(Object.values(CALENDAR_KIND_HUE)).size).toBe(3);
  });

  it("draws one row per task handed to many, with its progress, and fills a done task's ring", () => {
    withTasksToday();
    render(<EventsPage />);

    const group = screen.getAllByRole("button", { name: /^service log/i });
    expect(group).toHaveLength(1);
    expect(group[0]).toHaveTextContent("0 of 3 done");
    const mine = screen.getByRole("button", { name: /^dues form/i });
    expect(within(mine).getByTestId("agenda-mark")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(within(mine).getByText("Dues form").className).toContain(
      "line-through",
    );
  });

  it("switches a kind off from its key, hiding rows and dots, and remembers it", async () => {
    withBirthdayToday();
    const user = userEvent.setup();
    const first = render(<EventsPage />);

    const toggle = screen.getByRole("button", { name: /^birthdays, \d/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Dana Lowe's birthday")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Dana Lowe's birthday")).toBeNull();
    expect(screen.queryByTestId(`events-dot-${today()}-birthdays`)).toBeNull();
    // Hidden, the count still says what it holds back.
    expect(toggle).toHaveTextContent("1");
    expect(
      JSON.parse(
        window.localStorage.getItem("frapp.events.hidden-kinds.user-1")!,
      ),
    ).toEqual({ hidden: ["birthdays"] });

    first.unmount();
    render(<EventsPage />);
    expect(screen.queryByText("Dana Lowe's birthday")).toBeNull();
    expect(
      screen.getByRole("button", { name: /^birthdays, \d/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("draws today and the picked day apart: the accent disc and a ring", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    const navigator = screen.getByRole("complementary", { name: "Navigator" });
    const todayButton = navigator.querySelector("[data-today]") as HTMLElement;
    expect(todayButton.querySelector("span")?.className).toContain(
      "bg-primary",
    );
    expect(navigator.querySelector("[data-picked]")).toBeNull();

    const meetingDay = new Date(EVENTS[0]!.start_time);
    if (meetingDay.getMonth() !== new Date().getMonth()) {
      await user.click(screen.getByRole("button", { name: "Next month" }));
    }
    const picked = within(navigator).getByRole("button", {
      name: new RegExp(
        `^${meetingDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`,
      ),
    });
    await user.click(picked);
    expect(picked).toHaveAttribute("aria-pressed", "true");
    const ring = picked.querySelector("span")!.className;
    expect(ring).toContain("ring-foreground");
    expect(ring).not.toContain("bg-primary");
  });

  it("re-anchors on a picked day it isn't showing, saying when it's empty", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    // Tomorrow holds nothing: the agenda starts there.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const navigator = screen.getByRole("complementary", { name: "Navigator" });
    if (tomorrow.getMonth() !== new Date().getMonth()) {
      await user.click(screen.getByRole("button", { name: "Next month" }));
    }
    await user.click(
      within(navigator).getByRole("button", {
        name: new RegExp(
          `^${tomorrow.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`,
        ),
      }),
    );
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Tomorrow");
    expect(screen.getByText("Nothing tomorrow.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^chapter meeting/i }),
    ).toBeInTheDocument();
  });

  it("scrolls to a picked day the agenda already lists, without re-anchoring", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const user = userEvent.setup();
    render(<EventsPage />);

    const meetingDay = new Date(EVENTS[0]!.start_time);
    if (meetingDay.getMonth() !== new Date().getMonth()) {
      await user.click(screen.getByRole("button", { name: "Next month" }));
    }
    const navigator = screen.getByRole("complementary", { name: "Navigator" });
    await user.click(
      within(navigator).getByRole("button", {
        name: new RegExp(
          `^${meetingDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`,
        ),
      }),
    );
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts[0]).toHaveAttribute(
      "id",
      `events-day-${localIsoDate(meetingDay)}`,
    );
    // Today still leads: the agenda didn't move.
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "Today",
    );
  });

  it("puts a week strip over the agenda on a narrow pane, stepping a week", async () => {
    narrowRef.current = true;
    const user = userEvent.setup();
    render(<EventsPage />);

    expect(
      screen.queryByRole("complementary", { name: "Navigator" }),
    ).toBeNull();
    const strip = screen.getByRole("region", { name: "Pick a day" });
    const days = within(strip)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAttribute("aria-current", "date");
    // The key sits under the strip, as one row.
    expect(
      screen.getByRole("group", { name: "Show on Events" }),
    ).toBeInTheDocument();

    await user.click(within(strip).getByRole("button", { name: "Next week" }));
    expect(strip.querySelector("[aria-current='date']")).toBeNull();

    // Hours shows the one day here.
    await user.click(screen.getByRole("button", { name: "Hours for Today" }));
    expect(
      screen.getAllByRole("button", { name: /^create event on/i }).length,
    ).toBe(24);
  });

  it("opens a day's Hours on the hour grid and comes back to the agenda", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    const meetingDay = new Date(EVENTS[0]!.start_time).toLocaleDateString(
      undefined,
      { weekday: "long" },
    );
    await user.click(
      screen.getByRole("button", { name: `Hours for ${meetingDay}` }),
    );
    expect(screen.queryByRole("region", { name: "Upcoming" })).toBeNull();
    // Three days from that one, its event a block on the grid.
    expect(
      screen.getAllByRole("button", { name: /^create event on/i }).length,
    ).toBe(24 * 3);
    expect(
      screen.getByRole("button", { name: /^view chapter meeting/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(
      screen.getByRole("region", { name: "Upcoming" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: meetingDay }),
    ).toBeInTheDocument();
  });
});

describe("EventsPage keeps the editor's draft (#4593)", () => {
  const tree = () => (
    <div data-tool-column="">
      <div data-tool-page="">
        <EventsPage />
      </div>
    </div>
  );

  async function startDraft(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^new event$/i }));
    await user.type(screen.getByLabelText("Event name"), "Formal");
  }

  it("reopens New event on its draft when the page was left with it open", async () => {
    const user = userEvent.setup();
    const first = render(tree());
    await startDraft(user);
    first.unmount();

    render(tree());
    const editor = await screen.findByRole("region", { name: "Create event" });
    expect(within(editor).getByLabelText("Event name")).toHaveValue("Formal");
    expect(within(editor).getByText("Draft restored")).toBeInTheDocument();
  });

  it("comes back to the page after Back, and New event opens on the draft", async () => {
    const user = userEvent.setup();
    const first = render(tree());
    await startDraft(user);
    await user.click(screen.getByRole("button", { name: "Back to events" }));
    first.unmount();

    render(tree());
    expect(screen.queryByRole("region", { name: "Create event" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^new event$/i }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Formal");
  });

  it("doesn't reopen the editor for a viewer who can no longer create events", async () => {
    const user = userEvent.setup();
    const first = render(tree());
    await startDraft(user);
    first.unmount();

    permissionsRef.current = ["members:view"];
    render(tree());
    expect(screen.queryByRole("region", { name: "Create event" })).toBeNull();
  });
});
