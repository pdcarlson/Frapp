import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * #1621 — the study surface's offline gate, which is the only three-way one on
 * the dashboard: `isOffline && !activeSession && hasNoCachedData(...)`.
 *
 * It gets its own cases because the shared predicate cannot observe either of
 * the other two terms. `!activeSession` is local `useState`, not a cache test —
 * on its own it blanked the screen for every offline member without a running
 * timer — and the query list is the surface's own decision. A refactor that
 * drops `sessionsQuery` from that list, or reorders the terms, reintroduces
 * #1621 here while every helper test still passes.
 *
 * Separate from `study-page.test.tsx` because that file pins `useNetwork` to a
 * literal and stubs the two reads as always-cached.
 */

const networkState = { isOffline: false };
const geofencesQuery: { data: unknown; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const sessionsQuery: { data: unknown; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};

const ZONE = {
  id: "zone-1",
  name: "Library 3rd floor",
  coordinates: null,
  is_active: true,
  minutes_per_point: 30,
  points_per_interval: 1,
  min_session_minutes: 15,
  pause_grace_minutes: 5,
};

const PAST_SESSION = {
  id: "sess-0",
  chapter_id: "chap-1",
  user_id: "u-1",
  geofence_id: "zone-1",
  status: "COMPLETED" as const,
  start_time: "2026-08-01T10:00:00Z",
  end_time: "2026-08-01T11:00:00Z",
  last_heartbeat_at: null,
  paused_at: null,
  total_foreground_minutes: 60,
  points_awarded: true,
  created_at: "2026-08-01T10:00:00Z",
};

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(() => ({
    data: { subscription_status: "active" },
    isPending: false,
    isError: false,
  })),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useGeofences: () => geofencesQuery,
  useStudySessions: () => sessionsQuery,
  useStartStudySession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStudyHeartbeat: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePauseStudySession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResumeStudySession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStopStudySession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActiveChapterId: () => "chap-1",
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { StudyPage } = await import("./study-page");

beforeEach(() => {
  vi.clearAllMocks();
  networkState.isOffline = false;
  geofencesQuery.data = [ZONE];
  geofencesQuery.isPending = false;
  sessionsQuery.data = [PAST_SESSION];
  sessionsQuery.isPending = false;
});

describe("StudyPage offline read path (#1621)", () => {
  it("keeps rendering cached zones and history when it goes offline", () => {
    networkState.isOffline = true;

    render(<StudyPage />);

    expect(
      screen.queryByText("Study hours unavailable offline"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Library 3rd floor")).toBeInTheDocument();
  });

  it("shows the offline card when the zones read is uncached", () => {
    networkState.isOffline = true;
    geofencesQuery.data = undefined;

    render(<StudyPage />);

    expect(
      screen.getByText("Study hours unavailable offline"),
    ).toBeInTheDocument();
  });

  /*
   * No case here for "a running session keeps its card with nothing cached",
   * and the reason is worth writing down because it is not obvious from the
   * gate: `activeSession` is set **only** by `handleStart` (`study-page.tsx`),
   * never restored from `sessionsQuery`. A server-side ACTIVE session does not
   * make the carve-out fire — the member has to have started it in this tab's
   * lifetime. So the state this test would describe is unreachable without
   * driving geolocation and the start mutation, and asserting it from
   * `sessionsQuery` alone would pin a behaviour the component does not have.
   *
   * That the timer is lost across a reload at all is pre-existing and
   * unchanged by #1621 — filed separately rather than papered over here.
   */
  it("shows the offline card when the sessions read is uncached", () => {
    // Pins `sessionsQuery`'s membership in the gate specifically: dropping it
    // from the list leaves this case rendering a history panel built from a
    // read that never answered.
    networkState.isOffline = true;
    sessionsQuery.data = undefined;

    render(<StudyPage />);

    expect(
      screen.getByText("Study hours unavailable offline"),
    ).toBeInTheDocument();
  });
});
