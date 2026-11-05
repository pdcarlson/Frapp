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
  useMyPermissions: () => ({ data: { permissions: ["events:update"] } }),
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
  it("tells a filtered list apart from an empty chapter", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /time window/i }),
      "past",
    );

    expect(
      screen.getByRole("heading", { name: "No events match the filters" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).toBeNull();
  });

  it("names the search that matched nothing", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);

    await user.type(
      screen.getByRole("searchbox", { name: /search events/i }),
      "gala",
    );

    expect(
      screen.getByRole("heading", { name: "No match for “gala”" }),
    ).toBeInTheDocument();
  });

  it("keeps the first-event CTA for a chapter with no events, on no card", () => {
    eventsQuery.data = [];
    const { container } = render(<EventsPage />);

    expect(
      screen.getByRole("heading", { name: "No events yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create first event/i }),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
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
