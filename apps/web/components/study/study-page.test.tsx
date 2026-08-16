import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockStart,
  mockPause,
  mockResume,
  mockStop,
  mockHeartbeat,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockStart: vi.fn(),
  mockPause: vi.fn().mockResolvedValue({}),
  mockResume: vi.fn().mockResolvedValue({}),
  mockStop: vi.fn().mockResolvedValue({}),
  mockHeartbeat: vi.fn().mockResolvedValue({}),
}));

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

const LIVE_SESSION = {
  ...PAST_SESSION,
  id: "sess-1",
  status: "ACTIVE" as const,
  end_time: null,
  total_foreground_minutes: 0,
  points_awarded: false,
};

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useGeofences: () => ({ data: [ZONE], isPending: false, isError: false }),
  useStudySessions: () => ({
    data: [PAST_SESSION],
    isPending: false,
    isError: false,
  }),
  useStartStudySession: () => ({ mutateAsync: mockStart, isPending: false }),
  useStudyHeartbeat: () => ({ mutateAsync: mockHeartbeat, isPending: false }),
  usePauseStudySession: () => ({ mutateAsync: mockPause, isPending: false }),
  useResumeStudySession: () => ({ mutateAsync: mockResume, isPending: false }),
  useStopStudySession: () => ({ mutateAsync: mockStop, isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { StudyPage } = await import("./study-page");

const chapter = chapterSubscription(mockCurrentChapter);

const startButton = () => screen.getByRole("button", { name: /start session/i });
const pauseButton = () => screen.getByRole("button", { name: /pause timer/i });
const stopButton = () => screen.getByRole("button", { name: /stop &/i });

/**
 * The pause / stop controls only exist once a session is running, and the page
 * learns that from the start response — so the live-session cases have to start
 * one on a paying chapter and then move the chapter underneath it.
 */
async function renderWithLiveSession() {
  chapter.active();
  const view = render(<StudyPage />);
  await userEvent.click(startButton());
  await screen.findByRole("button", { name: /stop &/i });
  return view;
}

describe("StudyPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockResolvedValue(LIVE_SESSION);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: PositionCallback) =>
          onSuccess({
            coords: { latitude: 42.73, longitude: -73.68 },
          } as GeolocationPosition),
      },
    });
  });

  it("leaves the session controls alone on an active chapter", () => {
    chapter.active();
    render(<StudyPage />);

    expect(startButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables Start and names blocker plus recovery when incomplete", () => {
    chapter.incomplete();
    render(<StudyPage />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(startButton()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    const describedBy = startButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("gates pause and stop too, not just Start", async () => {
    // Pause / resume / stop are three more paid-ops writes; leaving them live
    // would have the page state that writes are blocked while offering them.
    const { rerender } = await renderWithLiveSession();

    chapter.incomplete();
    rerender(<StudyPage />);

    expect(pauseButton()).toBeDisabled();
    expect(stopButton()).toBeDisabled();
  });

  it("leaves pause and stop live while the chapter is paying", async () => {
    await renderWithLiveSession();

    expect(pauseButton()).toBeEnabled();
    expect(stopButton()).toBeEnabled();
  });

  it("keeps session history readable while writes are blocked", () => {
    // §5: `enforceSubscription` returns early for GET, so a lapsed chapter can
    // still read everything it owns — and disable, don't hide (rule 4).
    chapter.incomplete();
    render(<StudyPage />);

    expect(screen.getByText(/session history/i)).toBeInTheDocument();
    expect(screen.getByText(/60 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of study
    // sessions; the server guard is still the enforcement.
    chapter.unreadable();
    render(<StudyPage />);

    expect(startButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    chapter.loading();
    render(<StudyPage />);

    expect(startButton()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
  });

  it("blocks paid-ops study writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<StudyPage />);

    expect(startButton()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });
});
