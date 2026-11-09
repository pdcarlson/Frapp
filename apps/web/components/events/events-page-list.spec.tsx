import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardFilledContainers } from "@/tests/card-surfaces";

/*
 * The flushed list (`spec/ui/web-dashboard/README.md` § Page grammar): no
 * wrapper card or table, a section label that follows the Time filter, the
 * select-all in the list header, house date shapes, and no badge or meta
 * clause standing in for an absent value.
 */

// Far-future starts keep both rows under the default Upcoming filter whenever
// the suite runs.
const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter Meeting",
    location: "Great Hall",
    start_time: "2099-01-01T18:00:00.000Z",
    end_time: "2099-01-01T19:00:00.000Z",
    is_mandatory: true,
    point_value: 5,
    recurrence_rule: "WEEKLY",
  },
  {
    id: "evt-2",
    name: "Study Night",
    location: null,
    start_time: "2099-01-02T18:00:00.000Z",
    end_time: "2099-01-02T20:00:00.000Z",
    is_mandatory: false,
    point_value: 0,
    recurrence_rule: null,
  },
];

const eventsQuery: { data: unknown } = { data: EVENTS };
const permissionsRef: { current: string[] } = {
  current: ["events:create", "events:update", "members:view"],
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => ({
    data: { subscription_status: "active", past_due_since: null },
    isPending: false,
    isError: false,
  }),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  EventDetailSheet: (props: { open: boolean; event: unknown }) => {
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

import { EventsPage } from "./events-page";

const row = (name: RegExp) => {
  const button = screen.getByRole("button", { name });
  const item = button.closest("li");
  if (!item) throw new Error("row is not a list item");
  return item;
};

beforeEach(() => {
  vi.clearAllMocks();
  eventsQuery.data = EVENTS;
  permissionsRef.current = ["events:create", "events:update", "members:view"];
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

  it("keeps the toolbar controls in one row, under the top bar's title", () => {
    render(<EventsPage />);

    // The route's h1 is the top bar's (`top-bar.tsx`), not the page's.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    const newEvent = screen.getByRole("button", { name: /new event/i });
    const toolbarRow = newEvent.parentElement;
    expect(toolbarRow).toBeTruthy();
    const scope = within(toolbarRow as HTMLElement);
    expect(
      scope.getByRole("searchbox", { name: /search events/i }),
    ).toBeInTheDocument();
    expect(scope.getAllByRole("combobox")).toHaveLength(3);
    expect(scope.getByRole("tab", { name: "List" })).toBeInTheDocument();
    expect(scope.getByRole("tab", { name: "Calendar" })).toBeInTheDocument();
    expect(
      scope.getByRole("button", { name: /new event/i }),
    ).toBeInTheDocument();
  });

  it("names the list for the Time filter it shows", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /time window/i }),
      "all",
    );
    expect(
      screen.getByRole("region", { name: "All events" }),
    ).toBeInTheDocument();
  });

  it("badges a mandatory, repeating event in words, never the raw token", () => {
    render(<EventsPage />);

    const meeting = within(row(/chapter meeting/i));
    expect(meeting.getByText("Mandatory")).toBeInTheDocument();
    // A status, so danger as the board and mobile draw it, never the accent
    // (components.md §5).
    expect(meeting.getByText("Mandatory").className).toContain(
      "text-destructive-text",
    );
    expect(meeting.getByText("Mandatory").className).not.toContain(
      "text-accent-text",
    );
    expect(meeting.getByText("Weekly")).toBeInTheDocument();
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

  it("selects every visible row from the list header and tints the selection", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

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
    // The select-all is not inside the selection strip, so clearing the
    // selection through it does not unmount the control that has focus.
    const selectAll = screen.getByRole("checkbox", {
      name: /select all visible events/i,
    });
    await user.click(selectAll);
    expect(selectAll).toBeInTheDocument();
    expect(screen.queryByText(/selected$/)).toBeNull();
  });
});

describe("EventsPage empty states", () => {
  it("says the time window is empty, not the chapter, and widens it", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /time window/i }),
      "past",
    );

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

    await user.selectOptions(
      screen.getByRole("combobox", { name: /attendance policy/i }),
      "mandatory",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /cadence/i }),
      "one-time",
    );

    expect(
      screen.getByText(/^No events match these filters\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /attendance policy/i }),
    ).toHaveValue("all");
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

    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("Pick a day to schedule the first event."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /no events yet/i }),
    ).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("waits for the events read before picking a tab", () => {
    // Picked on the loading render, `events` would be [] and every chapter,
    // events or not, would open on the calendar and stay there.
    eventsQuery.data = undefined;
    const { rerender } = render(<EventsPage />);

    eventsQuery.data = EVENTS;
    rerender(<EventsPage />);

    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("stays on the calendar once the first event arrives", () => {
    eventsQuery.data = [];
    const { rerender } = render(<EventsPage />);

    eventsQuery.data = EVENTS;
    rerender(<EventsPage />);

    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says so in one line if the list is opened anyway", async () => {
    const user = userEvent.setup();
    eventsQuery.data = [];
    render(<EventsPage />);

    await user.click(screen.getByRole("tab", { name: "List" }));

    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /select all/i })).toBeNull();
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

describe("EventsPage calendar", () => {
  it("renders flush, with no card title or description", async () => {
    const user = userEvent.setup();
    const { container } = render(<EventsPage />);

    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    expect(screen.queryByText("Chapter Calendar")).toBeNull();
    expect(screen.queryByText(/click a date to schedule/i)).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });
});
