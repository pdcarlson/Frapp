import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardFilledContainers } from "@/tests/card-surfaces";

/*
 * The flushed list (`spec/ui/web-dashboard/README.md` § Page grammar): no
 * wrapper card or table, a section label that follows the Time filter, rows
 * under written-out day headings, one row per repeating series, a two-week
 * horizon with Later behind it, the filters behind one Filter button, bulk
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

const eventsQuery: { data: unknown } = { data: EVENTS };
const permissionsRef: { current: string[] } = {
  current: ["events:create", "events:update", "members:view"],
};

// "This time last year" (#3930) has its own spec.
vi.mock("@/components/ai/suggested-events", () => ({
  SuggestedEvents: () => null,
  useRecordPlannedEvent: () => async () => undefined,
}));

vi.mock("@repo/hooks", () => ({
  // The toolbar's Subscribe menu (#3322) asks for nothing until it opens.
  useCalendarFeedLink: () => ({ data: undefined, isError: false }),
  useResetCalendarFeedLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  calendarAppLinks: () => null,
  useGoogleCalendarStatus: () => ({ data: undefined }),
  useStartGoogleCalendarConnect: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmGoogleCalendarConnect: () => ({ mutateAsync: vi.fn() }),
  useDisconnectGoogleCalendar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  readGoogleCalendarReturn: () => null,
  GOOGLE_CALENDAR_RETURN_PARAMS: [],
  useActiveChapterId: () => "chap-1",
  useCalendarTasks: () => ({ items: [], hasMine: false, hasAssigned: false }),
  useChapterRoster: () => ({ data: [] }),
  useCurrentChapter: () => ({
    data: { subscription_status: "active", past_due_since: null },
    isPending: false,
    isError: false,
  }),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvent: () => ({ data: undefined, isPending: false, isError: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [], isError: false }),
  useEvents: () => ({
    data: eventsQuery.data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAutoAbsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMyPermissions: () => ({
    data: { permissions: permissionsRef.current },
    isLoading: false,
  }),
  useNow: () => Date.now(),
}));

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
  vi.clearAllMocks();
  window.localStorage.clear();
  viewerRef.current = { userId: "user-1", isLoading: false };
  eventsQuery.data = EVENTS;
  permissionsRef.current = ["events:create", "events:update", "members:view"];
  searchRef.current = new URLSearchParams();
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

  it("keeps one toolbar row: the view toggle, search, one Filter button, New event", () => {
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
    const view = scope.getByRole("radiogroup", { name: "View" });
    expect(within(view).getByRole("radio", { name: "List" })).toBeChecked();
    expect(
      within(view).getByRole("radio", { name: "Calendar" }),
    ).not.toBeChecked();
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

  it("groups rows under written-out day headings", () => {
    render(<EventsPage />);

    const meetingDay = new Date(EVENTS[0]!.start_time).toLocaleDateString(
      undefined,
      { weekday: "long" },
    );
    expect(
      screen.getByRole("heading", { level: 3, name: meetingDay }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
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

  it("keeps what starts after the next two weeks behind Later", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [
      EVENTS[1],
      { ...EVENTS[0], id: "far", name: "Formal", start_time: daysOut(30) },
    ];
    render(<EventsPage />);

    const upcoming = within(screen.getByRole("region", { name: "Upcoming" }));
    expect(upcoming.getAllByText("1 event")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^formal/i })).toBeNull();
    const later = screen.getByRole("button", { name: /later/i });
    expect(later).toHaveAttribute("aria-expanded", "false");

    await user.click(later);
    expect(later).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /^formal/i }),
    ).toBeInTheDocument();
  });

  it("says the next two weeks are clear when only Later holds events", () => {
    eventsQuery.data = [{ ...EVENTS[1], start_time: daysOut(30) }];
    render(<EventsPage />);

    expect(
      screen.getByText("Nothing in the next two weeks."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
  });

  it("badges a mandatory event in words, quietly", () => {
    render(<EventsPage />);

    const meeting = within(row(/chapter meeting/i));
    expect(meeting.getByText("Mandatory")).toBeInTheDocument();
    // The hairline kind, not a red pill on every row (#3822), and never the
    // accent (components.md §5).
    expect(meeting.getByText("Mandatory").className).toContain(
      "text-muted-foreground",
    );
    expect(meeting.getByText("Mandatory").className).not.toContain(
      "text-destructive-text",
    );
    expect(meeting.getByText("Mandatory").className).not.toContain(
      "text-accent-text",
    );
    expect(meeting.queryByText("WEEKLY")).toBeNull();
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

  it("counts Time on the Filter button only in the list, the view it applies to", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await openFilters(user);
    await pick(user, "Time", "Past");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Filter events, 1 on" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(
      screen.getByRole("button", { name: "Filter events" }),
    ).toBeInTheDocument();
  });

  it("selects only what's on screen: Later's rows only while it's open", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [
      EVENTS[1],
      { ...EVENTS[0], id: "far", name: "Formal", start_time: daysOut(30) },
    ];
    render(<EventsPage />);

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: /select all visible events/i }),
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    const later = screen.getByRole("button", { name: /later/i });
    await user.click(later);
    expect(
      screen.getByRole("checkbox", { name: /select formal/i }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /select formal/i }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    // Collapsed, Formal is off screen: the count drops it.
    await user.click(later);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("keeps Select's Done when no row is on screen", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [{ ...EVENTS[1], start_time: daysOut(30) }];
    render(<EventsPage />);

    const later = screen.getByRole("button", { name: /later/i });
    await user.click(later);
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("checkbox", { name: /select study night/i }),
    );
    await user.click(later);

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Out of the mode; with no row on screen there's nothing to Select.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
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

  it("opens a chapter with no events on the calendar, on no card", () => {
    eventsQuery.data = [];
    const { container } = render(<EventsPage />);

    expect(screen.getByRole("radio", { name: "Calendar" })).toBeChecked();
    expect(
      screen.getByText("Pick a day to schedule the first event."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /no events yet/i }),
    ).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("waits for the events read before picking a view", () => {
    // Picked on the loading render, `events` would be [] and every chapter,
    // events or not, would open on the calendar and stay there.
    eventsQuery.data = undefined;
    const { rerender } = render(<EventsPage />);

    eventsQuery.data = EVENTS;
    rerender(<EventsPage />);

    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
  });

  it("stays on the calendar once the first event arrives", () => {
    eventsQuery.data = [];
    const { rerender } = render(<EventsPage />);

    eventsQuery.data = EVENTS;
    rerender(<EventsPage />);

    expect(screen.getByRole("radio", { name: "Calendar" })).toBeChecked();
  });

  it("says so in one line if the list is opened anyway", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [];
    render(<EventsPage />);

    await user.click(screen.getByRole("radio", { name: "List" }));

    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
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

  it("gives a member the calendar without a create control", () => {
    permissionsRef.current = ["members:view"];
    eventsQuery.data = [];
    render(<EventsPage />);

    expect(
      screen.getByText("Nothing on the calendar yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new event/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^create event on/i }),
    ).toBeNull();
  });
});

describe("EventsPage view memory", () => {
  it("opens on the view this person last chose, across a reload", async () => {
    const user = userEvent.setup();
    const first = render(<EventsPage />);

    await user.click(screen.getByRole("radio", { name: "Calendar" }));
    first.unmount();

    render(<EventsPage />);
    expect(screen.getByRole("radio", { name: "Calendar" })).toBeChecked();
  });

  it("waits for the viewer before picking a view, so a stored Calendar never flashes the list", () => {
    window.localStorage.setItem("frapp.events.view.user-1", "calendar");
    viewerRef.current = { userId: null, isLoading: true };
    const { rerender } = render(<EventsPage />);

    // Events are in, the viewer isn't: no list painted to jump away from.
    expect(screen.queryByRole("radio", { name: "List" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Upcoming" })).toBeNull();

    viewerRef.current = { userId: "user-1", isLoading: false };
    rerender(<EventsPage />);
    expect(screen.getByRole("radio", { name: "Calendar" })).toBeChecked();
  });

  it("lets a stored List win over an empty chapter's calendar", () => {
    window.localStorage.setItem("frapp.events.view.user-1", "list");
    eventsQuery.data = [];
    render(<EventsPage />);

    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });
});

describe("EventsPage calendar", () => {
  it("renders flush, with no card title or description", async () => {
    const user = userEvent.setup();
    const { container } = render(<EventsPage />);

    await user.click(screen.getByRole("radio", { name: "Calendar" }));

    expect(screen.queryByText("Chapter Calendar")).toBeNull();
    expect(screen.queryByText(/click a date to schedule/i)).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });
});
