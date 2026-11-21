import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Last week and This semester, which #5779 moved from Activity to the
 * member's profile beside Points (`StandingCards`). These tests came with
 * them from `activity-page.spec.tsx`; the profile's own spec owns whether
 * the profile draws them.
 */
const mockStanding = vi.fn<() => { isPending: boolean; data?: unknown }>(
  () => ({ isPending: false, data: undefined }),
);
const mockRecap = vi.fn<() => { data?: unknown }>(() => ({
  data: undefined,
}));
const mockChapterId = vi.fn(() => "chap-1");
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  // The model is the real one (`activity-standing.ts`, the recap card's
  // rules); only the reads are stood in for.
  return {
    ...actual,
    useActiveChapterId: () => mockChapterId(),
    useActivityStanding: () => mockStanding(),
    useActivityRecap: () => mockRecap(),
  };
});

const { StandingCards } = await import("./standing-cards");
const { RECAP_DISMISSED_STORAGE_KEY, resetRecapDismissalForTests } =
  await import("./recap-card");

beforeEach(() => {
  vi.clearAllMocks();
  mockStanding.mockReturnValue({ isPending: false, data: undefined });
  mockRecap.mockReturnValue({ data: undefined });
  mockChapterId.mockReturnValue("chap-1");
  window.localStorage.clear();
  resetRecapDismissalForTests();
});

describe("StandingCards: Last week (#4983)", () => {
  beforeEach(() => {
    // A Monday morning: the card's season.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 9));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const recap = {
    start: new Date(2026, 10, 8).toISOString(),
    end: new Date(2026, 10, 15).toISOString(),
    events_attended: 2,
    tasks_done: 0,
    points: 15,
    service_minutes: null,
    study_minutes: 90,
    unavailable: ["service"],
  };

  it("sums up last week with only what the member did, and stays gone once dismissed", () => {
    mockRecap.mockReturnValue({ data: recap });
    const { unmount } = render(<StandingCards />);

    const card = screen.getByRole("region", { name: "Last week" });
    expect(
      within(card).getByText("November 8 – November 14"),
    ).toBeInTheDocument();
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["2 events attended", "15 points earned", "1h 30m studied"]);

    fireEvent.click(
      within(card).getByRole("button", { name: "Dismiss last week's recap" }),
    );
    expect(screen.queryByRole("region", { name: "Last week" })).toBeNull();
    expect(window.localStorage.getItem(RECAP_DISMISSED_STORAGE_KEY)).toBe(
      `chap-1@${recap.end}`,
    );

    // Remembered across visits, until next week's recap.
    unmount();
    resetRecapDismissalForTests();
    const again = render(<StandingCards />);
    expect(screen.queryByRole("region", { name: "Last week" })).toBeNull();

    // Another chapter's recap that week still shows.
    again.unmount();
    mockChapterId.mockReturnValue("chap-2");
    const other = render(<StandingCards />);
    expect(
      screen.getByRole("region", { name: "Last week" }),
    ).toBeInTheDocument();

    // And so does this chapter's next week.
    other.unmount();
    mockChapterId.mockReturnValue("chap-1");
    vi.setSystemTime(new Date(2026, 10, 23, 9));
    mockRecap.mockReturnValue({
      data: {
        ...recap,
        start: new Date(2026, 10, 15).toISOString(),
        end: new Date(2026, 10, 22).toISOString(),
      },
    });
    render(<StandingCards />);
    expect(
      screen.getByRole("region", { name: "Last week" }),
    ).toBeInTheDocument();
  });

  it("draws nothing after Tuesday, whatever the read still holds", () => {
    vi.setSystemTime(new Date(2026, 10, 18, 9));
    mockRecap.mockReturnValue({ data: recap });
    render(<StandingCards />);
    expect(screen.queryByText("Last week")).toBeNull();
  });

  it("draws nothing for a week with nothing to show", () => {
    mockRecap.mockReturnValue({
      data: { ...recap, events_attended: 0, points: 0, study_minutes: 0 },
    });
    render(<StandingCards />);
    expect(screen.queryByText("Last week")).toBeNull();
  });
});

describe("StandingCards: This semester (#4766)", () => {
  it("draws a gauge per number, each linking to the page that owns it, with a ring only toward a target", () => {
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 42, rank: 5, ranked: 58, goal: null },
        required_events: { required: 8, attended: 6, excused: 1 },
        service: null,
        study: null,
        unavailable: ["service"],
      },
    });
    render(<StandingCards />);

    const standing = screen.getByRole("region", { name: "This semester" });
    expect(
      within(standing).getByRole("link", {
        name: "Attended 6 of 8 required events this semester, 1 excused",
      }),
    ).toHaveAttribute("href", "/events");
    expect(
      within(standing).getByTestId("activity-gauge-ring-required_events"),
    ).toHaveAttribute("data-progress", "0.75");
    // No goal for points: the number stands alone, with no invented end.
    const points = within(standing).getByRole("link", {
      name: "42 points this semester, ranked 5 of 58",
    });
    expect(points).toHaveAttribute("href", "/points");
    expect(
      within(standing).queryByTestId("activity-gauge-ring-points"),
    ).toBeNull();
    // A part that couldn't load says so, and never reads as zero.
    const service = within(standing).getByRole("link", {
      name: "Service hours: couldn't load",
    });
    expect(service).toHaveAttribute("href", "/service");
    expect(service).toHaveTextContent("–");
    expect(service).toHaveTextContent("Couldn't load");
    // Study wasn't served and didn't fail: no gauge, not a zero.
    expect(within(standing).getAllByRole("link")).toHaveLength(3);
  });

  it("closes a gauge that has reached its goal in the success hue", () => {
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 160, rank: 1, ranked: 58, goal: 150 },
        required_events: { required: 8, attended: 6, excused: 0 },
        service: null,
        study: null,
        unavailable: [],
      },
    });
    render(<StandingCards />);

    expect(
      screen
        .getByTestId("activity-gauge-ring-points")
        .querySelector("circle.text-success"),
    ).not.toBeNull();
    expect(
      screen
        .getByTestId("activity-gauge-ring-required_events")
        .querySelector("circle.text-primary"),
    ).not.toBeNull();
  });

  it("lays its gauges out by its container's width, never the window's", () => {
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 42, rank: 5, ranked: 58, goal: 60 },
        required_events: { required: 8, attended: 6, excused: 0 },
        service: {
          approved_minutes: 270,
          pending_minutes: 0,
          goal_minutes: 600,
        },
        study: {
          minutes: 125,
          week_start: "2026-11-08T05:00:00.000Z",
          goal_minutes: 360,
        },
        unavailable: [],
      },
    });
    render(<StandingCards />);

    const grid = screen
      .getByRole("region", { name: "This semester" })
      .querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-2", "@3xl:grid-cols-4");
    expect(grid?.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
  });

  it("isn't drawn for a new member in a chapter with no goals", () => {
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 0, rank: null, ranked: 0, goal: null },
        required_events: { required: 0, attended: 0, excused: 0 },
        service: {
          approved_minutes: 0,
          pending_minutes: 0,
          goal_minutes: null,
        },
        study: null,
        unavailable: [],
      },
    });
    render(<StandingCards />);

    expect(screen.queryByRole("region", { name: "This semester" })).toBeNull();
    expect(screen.queryByText("This semester")).toBeNull();
  });

  it("draws nothing when both reads have nothing, and a skeleton while the standing loads", () => {
    const { container, unmount } = render(<StandingCards />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    mockStanding.mockReturnValue({ isPending: true });
    const pending = render(<StandingCards />);
    expect(pending.container).not.toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "This semester" })).toBeNull();
  });
});
