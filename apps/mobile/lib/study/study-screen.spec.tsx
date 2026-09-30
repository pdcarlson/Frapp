/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "react-native";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import { MODULE_OFF_COPY } from "@/lib/study/errors";

/**
 * s10's refusal wiring (#2297, and the module gate #2393), rendered (#2416).
 *
 * A refused session write must withdraw Start, and must not spin the
 * pause/resume mirror, because nothing on the device can clear the refusal.
 * Every other failure keeps both. And a tab screen is never unmounted, so the
 * latch has to clear when the member comes back, or Start stays greyed out
 * until a force-quit after an officer has fixed the billing.
 *
 * These replace source-string locks that proved a token was in the file, not
 * that Start was withdrawn. Deleting the `setWriteRefused(true)` on the
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

/**
 * What `ChapterGuard` throws when an officer has switched `hours` off, without
 * its `code`, so only the message identifies it: the path installed builds and
 * an API older than #1020 rely on.
 */
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("hours"),
  requestId: "req_module_off",
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
/** `HEARTBEAT_INTERVAL_MS` in the screen. */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

const HOURS_ON = { enabled_modules: { hours: true } };
const HOURS_OFF = { enabled_modules: { hours: false } };
/** The chapter payload `useCurrentChapter` answers with. */
let chapter: unknown = HOURS_ON;
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
  useCurrentChapter: () => ({ data: chapter }),
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
  chapter = HOURS_ON;
});

const endButton = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "End session" &&
      node.type === ("Pressable" as never),
  );

/** How many times `text` appears on screen. */
const occurrences = (tree: ReactTestRenderer, text: string) =>
  screenText(tree).split(text).length - 1;

const MODULE_OFF_TITLE = "Study hours are turned off";

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

describe("Study on a module-off refusal (#2393)", () => {
  it("explains it in the member's terms on Start, withdraws Start, and offers it again on return", async () => {
    api.start.mockRejectedValue(MODULE_OFF);
    const tree = render();
    await tapStart(tree);

    expect(screenText(tree)).toContain(MODULE_OFF_COPY.start);
    // The guard's own words tell an officer to go to Settings → Modules.
    expect(screenText(tree)).not.toContain(MODULE_OFF.message);
    expect(startButton(tree).props.disabled).toBe(true);

    act(() => refocus());

    expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.start);
    expect(startButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  describe("with a session running", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
      sessions = LIVE_SESSION;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not re-send a refused pause, and says why", async () => {
      api.pause.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        appStateListener()("background");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRROR_RETRY_MS + 1_000);
      });

      expect(api.pause).toHaveBeenCalledTimes(1);
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
      expect(screenText(tree)).not.toContain(MODULE_OFF.message);
      act(() => tree.unmount());
    });

    it("says why when a heartbeat is refused, instead of swallowing it as transient", async () => {
      api.heartbeat.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(api.heartbeat).toHaveBeenCalled();
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
      act(() => tree.unmount());
    });

    it("drops the copy once a write succeeds again, after an officer turns hours back on", async () => {
      api.heartbeat
        .mockRejectedValueOnce(MODULE_OFF)
        .mockResolvedValue(LIVE_SESSION[0]);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      });

      expect(api.heartbeat).toHaveBeenCalledTimes(2);
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.session);
      act(() => tree.unmount());
    });

    it("lets go of the refusal with the session when the server says it is gone", async () => {
      // Refused, then the session is stopped elsewhere: the next beat 404s.
      api.heartbeat
        .mockRejectedValueOnce(MODULE_OFF)
        .mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
      sessions = NO_SESSIONS;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      });

      // Without the release clearing the latch, Start comes back greyed out
      // under nothing but the "already closed" notice.
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.session);
      expect(startButton(tree).props.disabled).toBe(false);
      act(() => tree.unmount());
    });
  });
});

describe("Study with hours switched off (#2718)", () => {
  it("shows the module-off empty state when no session is running", () => {
    chapter = HOURS_OFF;
    const tree = render();

    expect(screenText(tree)).toContain(MODULE_OFF_TITLE);
    expect(occurrences(tree, MODULE_OFF_COPY.start)).toBe(1);
    act(() => tree.unmount());
  });

  it("does not repeat a refused Start's copy above the empty state it matches", async () => {
    // Start refused while the cached payload still said `hours` was on; the
    // payload then catches up. The failure line and the empty state's body are
    // the same sentence.
    api.start.mockRejectedValue(MODULE_OFF);
    const tree = render();
    await tapStart(tree);
    expect(screenText(tree)).toContain(MODULE_OFF_COPY.start);

    chapter = HOURS_OFF;
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <StudyScreen />
        </FrappThemeProvider>,
      ),
    );

    expect(screenText(tree)).toContain(MODULE_OFF_TITLE);
    expect(occurrences(tree, MODULE_OFF_COPY.start)).toBe(1);
    act(() => tree.unmount());
  });

  describe("with a session running", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
      sessions = LIVE_SESSION;
      chapter = HOURS_OFF;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps the session's card and End instead of the empty state", () => {
      // Still ACTIVE server-side, and credited in full if an officer turns
      // hours back on before it goes stale.
      const tree = render();

      expect(endButton(tree)).toHaveLength(1);
      expect(screenText(tree)).not.toContain(MODULE_OFF_TITLE);
      act(() => tree.unmount());
    });

    it("explains a refused heartbeat beside the session, not above an empty state", async () => {
      api.heartbeat.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(api.heartbeat).toHaveBeenCalled();
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
      expect(endButton(tree)).toHaveLength(1);
      expect(screenText(tree)).not.toContain(MODULE_OFF_TITLE);
      act(() => tree.unmount());
    });

    it("falls back to the empty state once the server says the session is gone", async () => {
      api.heartbeat
        .mockRejectedValueOnce(MODULE_OFF)
        .mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      sessions = NO_SESSIONS;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      });

      expect(endButton(tree)).toHaveLength(0);
      expect(screenText(tree)).toContain(MODULE_OFF_TITLE);
      // The in-session sentence went with the session it described.
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.session);
      act(() => tree.unmount());
    });
  });
});
