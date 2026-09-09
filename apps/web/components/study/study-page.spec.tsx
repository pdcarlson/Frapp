import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
const sessionsQuery = {
  data: [PAST_SESSION] as unknown[],
  isPending: false,
  isError: false,
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useGeofences: () => ({ data: [ZONE], isPending: false, isError: false }),
  useStudySessions: () => sessionsQuery,
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

const {
  StudyPage,
  accuracyMetersOf,
  studyHeartbeatBody,
  HEARTBEAT_INTERVAL_MS,
} = await import("./study-page");

function stubGeolocation(accuracy?: number | null) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (onSuccess: PositionCallback) =>
        onSuccess({
          coords: {
            latitude: 42.73,
            longitude: -73.68,
            ...(accuracy === undefined ? {} : { accuracy }),
          },
        } as GeolocationPosition),
    },
  });
}

const chapter = chapterSubscription(mockCurrentChapter);

const startButton = () =>
  screen.getByRole("button", { name: /start session/i });
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
    sessionsQuery.data = [PAST_SESSION];
    mockStart.mockResolvedValue(LIVE_SESSION);
    stubGeolocation();
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

  it("leaves the exits from a running session live when the chapter lapses", async () => {
    // Deliberately NOT gated, unlike Start. `handleStop`'s `finally` is the only
    // thing that clears `activeSession` locally, and it runs even when the
    // server rejects — so gating Stop would pin the member to a live timer they
    // cannot end, while the ungated heartbeat keeps firing. The only remaining
    // exit would be closing the tab, which fires the same stop write from
    // `pagehide`. Never gate the way out.
    const { rerender } = await renderWithLiveSession();

    chapter.incomplete();
    rerender(<StudyPage />);

    expect(pauseButton()).toBeEnabled();
    expect(stopButton()).toBeEnabled();
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

describe("StudyPage restores a live session from the list (#1747)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionsQuery.data = [PAST_SESSION];
    sessionsQuery.isPending = false;
    sessionsQuery.isError = false;
    mockStop.mockResolvedValue({});
    stubGeolocation();
    chapter.active();
  });

  function liveRow(
    overrides: {
      id?: string;
      geofence_id?: string;
      last_heartbeat_at?: string | null;
      paused_at?: string | null;
      total_foreground_minutes?: number;
    } = {},
  ) {
    return {
      ...PAST_SESSION,
      id: "sess-live",
      status: "ACTIVE" as const,
      end_time: null,
      last_heartbeat_at: PAST_SESSION.start_time,
      paused_at: null,
      total_foreground_minutes: 12,
      points_awarded: false,
      ...overrides,
    };
  }

  it("adopts an ACTIVE row so Stop and the timer are present without clicking Start", async () => {
    sessionsQuery.data = [liveRow()];
    render(<StudyPage />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /start session/i }),
      ).not.toBeInTheDocument();
    });
    expect(stopButton()).toBeEnabled();
    expect(screen.getByText("Library 3rd floor")).toBeInTheDocument();
    // 12 banked minutes + HEARTBEAT_STALE_SECONDS (10 min): the watermark is
    // 2026-08-01, so the open gap is clamped rather than open-ended. The
    // 1s elapsed interval may tick once during waitFor.
    expect(screen.getByText(/^22:\d{2}$/)).toBeInTheDocument();
    expect(mockPause).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("restores a paused ACTIVE row as paused, with banked time only", async () => {
    sessionsQuery.data = [
      liveRow({
        id: "sess-paused",
        last_heartbeat_at: "2026-08-01T10:02:00Z",
        paused_at: "2026-08-01T10:02:00Z",
        total_foreground_minutes: 5,
      }),
    ];
    render(<StudyPage />);

    await waitFor(() => {
      expect(screen.getByText("Manually paused")).toBeInTheDocument();
    });
    expect(stopButton()).toBeEnabled();
    expect(screen.getByText("05:00")).toBeInTheDocument();
    expect(mockPause).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("still restores when the geofence row is gone, with the generic title", async () => {
    sessionsQuery.data = [
      liveRow({ id: "sess-orphan", geofence_id: "gone-zone" }),
    ];
    render(<StudyPage />);

    await waitFor(() => {
      expect(stopButton()).toBeEnabled();
    });
    expect(screen.getByText("Study session")).toBeInTheDocument();
    expect(screen.queryByText("Library 3rd floor")).not.toBeInTheDocument();
  });

  it("does not re-adopt a session this tab just stopped while the list is still stale", async () => {
    sessionsQuery.data = [liveRow()];
    render(<StudyPage />);
    await waitFor(() => {
      expect(stopButton()).toBeEnabled();
    });

    await userEvent.click(stopButton());

    await waitFor(() => {
      expect(startButton()).toBeEnabled();
    });
    expect(
      screen.queryByRole("button", { name: /stop &/i }),
    ).not.toBeInTheDocument();
    expect(mockStop).toHaveBeenCalled();
  });

  it("does not re-adopt a session the server just ended on heartbeat", async () => {
    const nativeSetInterval = globalThis.setInterval.bind(globalThis);
    const capturedIntervals: Array<{ handler: TimerHandler; delay: number }> =
      [];
    const spy = vi.spyOn(globalThis, "setInterval").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      capturedIntervals.push({ handler, delay: Number(delay) });
      return nativeSetInterval(handler, delay, ...(args as []));
    }) as typeof setInterval);
    try {
      const row = liveRow();
      sessionsQuery.data = [row];
      mockHeartbeat.mockResolvedValue({ ...row, status: "EXPIRED" });
      render(<StudyPage />);
      await waitFor(() => {
        expect(stopButton()).toBeEnabled();
      });

      const tick = capturedIntervals.find(
        (entry) => entry.delay === HEARTBEAT_INTERVAL_MS,
      );
      expect(tick).toBeDefined();
      await act(async () => {
        (tick!.handler as () => void)();
      });

      await waitFor(() => {
        expect(startButton()).toBeEnabled();
      });
      expect(
        screen.queryByRole("button", { name: /stop &/i }),
      ).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("accuracyMetersOf / studyHeartbeatBody (#1852)", () => {
  it("returns a positive finite reading", () => {
    expect(accuracyMetersOf(12.5)).toBe(12.5);
  });

  it("omits null, undefined, zero, negative, and non-finite values", () => {
    expect(accuracyMetersOf(null)).toBeUndefined();
    expect(accuracyMetersOf(undefined)).toBeUndefined();
    expect(accuracyMetersOf(0)).toBeUndefined();
    expect(accuracyMetersOf(-1)).toBeUndefined();
    expect(accuracyMetersOf(Number.NaN)).toBeUndefined();
    expect(accuracyMetersOf(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("includes accuracy_meters only when the reading is usable", () => {
    expect(
      studyHeartbeatBody({
        latitude: 42.73,
        longitude: -73.68,
        accuracy: 12,
      }),
    ).toEqual({ lat: 42.73, lng: -73.68, accuracy_meters: 12 });
    expect(
      studyHeartbeatBody({
        latitude: 42.73,
        longitude: -73.68,
        accuracy: 0,
      }),
    ).toEqual({ lat: 42.73, lng: -73.68 });
    expect(studyHeartbeatBody({ latitude: 42.73, longitude: -73.68 })).toEqual({
      lat: 42.73,
      lng: -73.68,
    });
  });
});

describe("StudyPage heartbeat accuracy (#1852)", () => {
  // `findBy*` / `waitFor` poll with `setInterval`. Faking that API hangs those
  // queries until the 5s test timeout (CI `web-tests` on #1853). Capture the
  // page's heartbeat tick instead and invoke it after start settles.
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  const capturedIntervals: Array<{ handler: TimerHandler; delay: number }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedIntervals.length = 0;
    mockStart.mockResolvedValue(LIVE_SESSION);
    mockHeartbeat.mockResolvedValue({});
    mockResume.mockResolvedValue({});
    mockPause.mockResolvedValue({});
    chapter.active();
    sessionsQuery.data = [PAST_SESSION];
    vi.spyOn(globalThis, "setInterval").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      capturedIntervals.push({ handler, delay: Number(delay) });
      return nativeSetInterval(handler, delay, ...(args as []));
    }) as typeof setInterval);
  });

  afterEach(() => {
    vi.mocked(globalThis.setInterval).mockRestore();
  });

  async function startLiveSessionAndFireHeartbeat() {
    render(<StudyPage />);
    await userEvent.click(startButton());
    await screen.findByRole("button", { name: /stop &/i });
    mockHeartbeat.mockClear();
    const tick = capturedIntervals.find(
      (entry) => entry.delay === HEARTBEAT_INTERVAL_MS,
    );
    expect(tick).toBeDefined();
    await act(async () => {
      (tick!.handler as () => void)();
    });
  }

  it("starts with lat/lng only even when the browser reports accuracy", async () => {
    stubGeolocation(12);
    render(<StudyPage />);
    await userEvent.click(startButton());
    await screen.findByRole("button", { name: /stop &/i });

    expect(mockStart).toHaveBeenCalledWith({
      geofence_id: ZONE.id,
      lat: 42.73,
      lng: -73.68,
    });
    expect(mockStart.mock.calls[0]?.[0]).not.toHaveProperty("accuracy_meters");
  });

  it("resumes with lat/lng only even when the browser reports accuracy", async () => {
    stubGeolocation(12);
    await renderWithLiveSession();

    await userEvent.click(pauseButton());
    await waitFor(() => expect(mockPause).toHaveBeenCalled());

    await userEvent.click(
      screen.getByRole("button", { name: /resume timer/i }),
    );
    await waitFor(() =>
      expect(mockResume).toHaveBeenCalledWith({
        lat: 42.73,
        lng: -73.68,
      }),
    );
    expect(mockResume.mock.calls[0]?.[0]).not.toHaveProperty("accuracy_meters");
  });

  it("posts accuracy_meters on heartbeat when the browser reports a positive finite reading", async () => {
    stubGeolocation(12);
    await startLiveSessionAndFireHeartbeat();

    await waitFor(() =>
      expect(mockHeartbeat).toHaveBeenCalledWith({
        lat: 42.73,
        lng: -73.68,
        accuracy_meters: 12,
      }),
    );
  });

  it("omits accuracy_meters on heartbeat when the reading is zero", async () => {
    stubGeolocation(0);
    await startLiveSessionAndFireHeartbeat();

    await waitFor(() =>
      expect(mockHeartbeat).toHaveBeenCalledWith({
        lat: 42.73,
        lng: -73.68,
      }),
    );
    expect(mockHeartbeat.mock.calls[0]?.[0]).not.toHaveProperty(
      "accuracy_meters",
    );
  });
});
