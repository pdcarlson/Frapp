import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * #1621 — the events surface must keep cached rows on screen when it goes
 * OFFLINE, per `spec/ui/resilience.md` § 2 (OFFLINE ⇒ Read Actions "Enabled
 * (from cache)").
 *
 * A separate file from `events-gating.test.tsx` and
 * `events-page-bulk-actions.test.tsx` because both of those pin
 * `useNetwork` to a literal `{ isOffline: false }`; this one needs it
 * mutable, and rewriting their harness to add a dimension they do not use
 * would put an unrelated risk into two passing suites.
 */

const networkState = { isOffline: false };
const eventsQuery: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: [], isLoading: false, isError: false, refetch: vi.fn() };

const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter Meeting",
    starts_at: "2026-09-01T18:00:00Z",
    ends_at: "2026-09-01T19:00:00Z",
    location: "Chapter House",
    status: "SCHEDULED",
  },
];

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  useActiveChapterId: () => "chap-1",
  useAttendance: () => ({ data: [], isPending: false, isError: false }),
  useMembers: () => ({ data: [], isPending: false, isError: false }),
  useUpdateAttendanceStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAutoAbsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvents: () => eventsQuery,
  useNow: () => Date.parse("2026-09-01T12:00:00Z"),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

vi.mock("./event-detail-sheet", () => ({ EventDetailSheet: () => null }));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

const { EventsPage } = await import("./events-page");

// The shared payload shape (#841) rather than a hand-rolled literal: the helper
// exists because two test files grew incompatible versions of this object, and
// a third would reintroduce exactly that drift.
const chapter = chapterSubscription(mockCurrentChapter);

beforeEach(() => {
  vi.clearAllMocks();
  chapter.active();
  networkState.isOffline = false;
  eventsQuery.data = EVENTS;
  eventsQuery.isLoading = false;
  eventsQuery.isError = false;
});

describe("EventsPage offline read path (#1621)", () => {
  it("keeps rendering cached events when it goes offline", () => {
    networkState.isOffline = true;

    render(<EventsPage />);

    expect(
      screen.queryByText("Events workspace unavailable offline"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Chapter Meeting")).toBeInTheDocument();
  });

  it("shows the offline card when there is nothing cached to render", () => {
    networkState.isOffline = true;
    eventsQuery.data = undefined;

    render(<EventsPage />);

    expect(
      screen.getByText("Events workspace unavailable offline"),
    ).toBeInTheDocument();
  });

  /*
   * This one pins the `isOffline` conjunct, not the cache half — it would pass
   * with `hasNoCachedData` deleted from the gate, and that is the point. The
   * two cases above pin the cache half; between them the whole conjunction is
   * covered, and dropping either term fails something.
   */
  it("does not show the offline card while online with no data yet", () => {
    eventsQuery.data = undefined;
    eventsQuery.isLoading = true;

    render(<EventsPage />);

    expect(
      screen.queryByText("Events workspace unavailable offline"),
    ).not.toBeInTheDocument();
  });
});
