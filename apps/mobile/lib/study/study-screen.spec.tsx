/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "react-native";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * s10's refusal wiring (#2297), rendered (#2416).
 *
 * A refused session write must withdraw Start, and must not spin the
 * pause/resume mirror, because nothing on the device can clear the refusal.
 * Every other failure keeps both. And a tab screen is never unmounted, so the
 * latch has to clear when the member comes back, or Start stays greyed out
 * until a force-quit after an officer has fixed the billing.
 *
 * These replace source-string locks that proved a token was in the file, not
 * that Start was withdrawn. Deleting the `setSubscriptionRefused(true)` on the
 * start path kept those green; it turns this suite red.
 *
 * It renders `app/(tabs)/study.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Study service is unavailable.",
  requestId: "req_failed",
};

/** `MIRROR_RETRY_MS` in the screen. */
const MIRROR_RETRY_MS = 15_000;

const CHAPTER = { enabled_modules: { hours: true } };
const ZONES = [{ id: "zone-1", name: "Library", is_active: true }];
const NO_SESSIONS: unknown[] = [];
const LIVE_SESSION = [
  {
    id: "session-1",
    geofence_id: "zone-1",
    status: "ACTIVE",
    start_time: "2026-09-27T12:00:00Z",
    last_heartbeat_at: "2026-09-27T12:00:00Z",
    paused_at: null,
  },
];

const api = {
  start: vi.fn(),
  heartbeat: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
};
let sessions: unknown[] = NO_SESSIONS;

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: CHAPTER }),
  useGeofences: () => ({
    data: ZONES,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useStudySessions: () => ({
    data: sessions,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue({ data: sessions }),
  }),
  useStartStudySession: () => ({ mutateAsync: api.start }),
  useStudyHeartbeat: () => ({ mutateAsync: api.heartbeat }),
  usePauseStudySession: () => ({ mutateAsync: api.pause }),
  useResumeStudySession: () => ({ mutateAsync: api.resume }),
  useStopStudySession: () => ({ mutateAsync: api.stop }),
}));

vi.mock("@/lib/location", () => ({
  readForegroundPermission: vi
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  requestForegroundPermission: vi
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  readForegroundFix: vi.fn().mockResolvedValue({ lat: 42.73, lng: -73.68 }),
  latLngOf: (fix: { lat: number; lng: number }) => ({
    lat: fix.lat,
    lng: fix.lng,
  }),
}));

vi.mock("@/lib/notifications/study-pause", () => ({
  notifyStudyPaused: vi.fn().mockResolvedValue(undefined),
  clearStudyPausedNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import StudyScreen from "@/app/(tabs)/study";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void })
  .__refocus;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <StudyScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * Everything the screen says, as one string, so a check for text the screen
 * must never show is a substring test. Matching whole `Text` elements would
 * miss the text inside a longer sentence (`<Text>Details: {message}</Text>`),
 * and `String()` of a children array joins it with commas.
 */
const screenText = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as never)
    .map((node) =>
      [node.props.children]
        .flat(Infinity)
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(""),
    )
    .join("\n");

const startButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "Start session" &&
      node.type === ("Pressable" as never),
  );

async function tapStart(tree: ReactTestRenderer) {
  await act(async () => {
    startButton(tree).props.onPress();
  });
}

/** The listener the screen registered last with the mocked `AppState`. */
function appStateListener(): (state: string) => void {
  const calls = vi.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1]![1] as (state: string) => void;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  sessions = NO_SESSIONS;
});

describe("Study Start on a subscription refusal (#2297)", () => {
  it("explains the refusal and withdraws Start", async () => {
    api.start.mockRejectedValue(REFUSED);
    const tree = render();
    expect(startButton(tree).props.disabled).toBe(false);

    await tapStart(tree);

    expect(api.start).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.study);
    // The server's own words are a purchase instruction, which the store
    // declaration forbids inside the app.
    expect(screenText(tree)).not.toContain(REFUSED.message);
    expect(startButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps Start after an ordinary failure", async () => {
    // The direction that got an earlier attempt at #2297 reverted: only a
    // refusal may withdraw the retry.
    api.start.mockRejectedValue(FAILED);
    const tree = render();
    await tapStart(tree);

    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.study);
    expect(startButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("offers Start again when the member comes back to the screen", async () => {
    api.start.mockRejectedValue(REFUSED);
    const tree = render();
    await tapStart(tree);
    expect(startButton(tree).props.disabled).toBe(true);

    act(() => refocus());

    // The copy goes with the latch: an enabled Start under a sentence saying
    // sessions cannot be recorded would offer and deny the same action.
    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.study);
    expect(startButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

describe("Study pause mirror on a subscription refusal (#2297)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
    sessions = LIVE_SESSION;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Backgrounds the app with a live session, then waits out one retry. */
  async function backgroundAndWait(tree: ReactTestRenderer) {
    await act(async () => {
      appStateListener()("background");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRROR_RETRY_MS + 1_000);
    });
    return tree;
  }

  it("does not re-send a refused pause", async () => {
    api.pause.mockRejectedValue(REFUSED);
    const tree = await backgroundAndWait(render());

    expect(api.pause).toHaveBeenCalledTimes(1);
    // A refused pause greys out nothing silently: the session copy says why.
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.studySession);
    act(() => tree.unmount());
  });

  it("re-sends a pause the network dropped", async () => {
    // Without the retry a single dropped pause lets the session accrue
    // background time until the grace window closes it.
    api.pause.mockRejectedValue(FAILED);
    const tree = await backgroundAndWait(render());

    expect(api.pause).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });
});
