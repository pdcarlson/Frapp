/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState, Platform } from "react-native";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import { MODULE_OFF_COPY, startErrorCopy } from "@/lib/study/errors";
import { drawnText } from "@/test/screen-text";
import { CardListSkeleton } from "@/components/card-list-skeleton";
import { SkeletonLines } from "@/components/state-block";
import { StartCard, StartCardSkeleton } from "@/components/study/start-card";
import { SessionCard } from "@/components/study/session-card";
import { ZonePickerSheet } from "@/components/study/zone-picker-sheet";
import {
  readForegroundFix,
  readForegroundPermission,
  requestForegroundPermission,
} from "@/lib/location";

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
 * It renders `app/(app)/study.tsx` but lives here: a spec under `app/` ships
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
/** The chapter query's `refetch`: a spec sets `chapter` from it to play the server's answer. */
const refetchChapter = vi.fn();
const ZONES = [{ id: "zone-1", name: "Library", is_active: true }];
/** Sorted by name on arrival, so "Commons" is the first zone. */
const TWO_ZONES = [
  { id: "zone-1", name: "Library", is_active: true },
  { id: "zone-2", name: "Commons", is_active: true },
];
/** What `useGeofences` answers with. */
let zones: unknown[] = ZONES;
/** Both reads still in flight, as on a cold open. */
let isLoading = false;
/** Only the sessions read in flight: zones can land first. */
let sessionsLoading = false;
/** The sessions read failed with nothing cached: not pending, no data. */
let sessionsFailed = false;
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
/** The zones and sessions queries' `refetch`, hoisted so a pull can be asserted on. */
const refetchZones = vi.fn();
const refetchSessions = vi.fn();

/** The viewer's permissions: a member unless a test says so. */
let permissions: string[] = [];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: chapter, refetch: refetchChapter }),
  usePermissionList: () => permissions,
  useGeofences: () => ({
    data: isLoading ? undefined : zones,
    isPending: isLoading,
    isError: false,
    isFetching: false,
    refetch: refetchZones,
  }),
  useStudySessions: () => ({
    data: isLoading || sessionsLoading || sessionsFailed ? undefined : sessions,
    isPending: isLoading || sessionsLoading,
    isError: sessionsFailed,
    isFetching: false,
    refetch: refetchSessions,
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

import StudyScreen from "@/app/(app)/study";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

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
  vi.mocked(readForegroundFix).mockResolvedValue({ lat: 42.73, lng: -73.68 });
  sessions = NO_SESSIONS;
  zones = ZONES;
  isLoading = false;
  sessionsLoading = false;
  sessionsFailed = false;
  chapter = HOURS_ON;
  refetchChapter.mockReset().mockResolvedValue(undefined);
  refetchZones.mockReset().mockResolvedValue(undefined);
  refetchSessions
    .mockReset()
    .mockImplementation(async () => ({ data: sessions }));
});

/** Re-render, as the query does when a refetch lands. */
function rerender(tree: ReactTestRenderer) {
  act(() =>
    tree.update(
      <FrappThemeProvider>
        <StudyScreen />
      </FrappThemeProvider>,
    ),
  );
}

const endButton = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "End session" &&
      node.type === ("Pressable" as never),
  );

/** How many times `text` appears on screen. */
const occurrences = (tree: ReactTestRenderer, text: string) =>
  screenText(tree).split(text).length - 1;

/** Whether the module-off line, in either form, stands where the screen was. */
const showsModuleOff = (tree: ReactTestRenderer) =>
  [MODULE_OFF_COPY.start, MODULE_OFF_COPY.runningSession].some((copy) =>
    screenText(tree).includes(copy),
  );

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

  it("refetches the cached payload when Start is refused for hours being off", async () => {
    // The refusal is the server saying hours is off; a payload that says on
    // is stale, and refetching it is what hands the screen to module-off.
    api.start.mockRejectedValue(MODULE_OFF);
    const tree = render();
    await tapStart(tree);

    expect(refetchChapter).toHaveBeenCalledTimes(1);
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

describe("Study when hours is switched off under a cached payload that says on (#2718)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
    sessions = LIVE_SESSION;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches the payload on a module-off refusal, so the module-off screen replaces the card", async () => {
    api.heartbeat.mockRejectedValue(MODULE_OFF);
    refetchChapter.mockImplementation(async () => {
      chapter = HOURS_OFF;
    });
    const tree = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    });
    expect(refetchChapter).toHaveBeenCalledTimes(1);
    rerender(tree);

    expect(endButton(tree)).toHaveLength(0);
    expect(screenText(tree)).toContain(MODULE_OFF_COPY.runningSession);
    expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.session);
    act(() => tree.unmount());
  });

  it("refetches nothing when there is no payload to correct", async () => {
    // No `active_chapter_id` claim: the query is disabled, `hoursEnabled`
    // failed open, and a manual refetch would send the read the hook withholds.
    chapter = undefined;
    api.heartbeat.mockRejectedValue(MODULE_OFF);
    const tree = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    });

    expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
    expect(refetchChapter).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("refetches nothing when a write succeeds under a payload that already says on", async () => {
    // A heartbeat every 5 minutes per live session would otherwise refetch
    // the chapter each time, past the hook's 5-minute staleTime.
    api.heartbeat.mockResolvedValue(LIVE_SESSION[0]);
    const tree = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    });

    expect(api.heartbeat).toHaveBeenCalled();
    expect(refetchChapter).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("follows hours off and back on again within one mount", async () => {
    // Mounted on, refused, refetched to off; then an officer turns hours back
    // on and the next beat gets through. That beat must see the payload's
    // current verdict, not the one the screen mounted with.
    api.heartbeat
      .mockRejectedValueOnce(MODULE_OFF)
      .mockResolvedValue(LIVE_SESSION[0]);
    refetchChapter
      .mockImplementationOnce(async () => {
        chapter = HOURS_OFF;
      })
      .mockImplementation(async () => {
        chapter = HOURS_ON;
      });
    const tree = render();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    });
    rerender(tree);
    expect(endButton(tree)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(refetchChapter).toHaveBeenCalledTimes(2);
    rerender(tree);

    expect(endButton(tree)).toHaveLength(1);
    expect(showsModuleOff(tree)).toBe(false);
    act(() => tree.unmount());
  });

  it("refetches nothing on a failure that isn't the module gate", async () => {
    api.heartbeat.mockRejectedValue(REFUSED);
    const tree = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    });

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.studySession);
    expect(refetchChapter).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("Study with hours switched off (#2718)", () => {
  it("shows the module-off empty state when no session is running", () => {
    chapter = HOURS_OFF;
    const tree = render();

    expect(showsModuleOff(tree)).toBe(true);
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

    expect(showsModuleOff(tree)).toBe(true);
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

    it("replaces the session's card with the module-off screen, which names the session", () => {
      // Every write on the card is refused while hours is off, and nothing
      // expires a stale session meanwhile, so the card would be a clamped
      // timer beside an End that can't work.
      const tree = render();

      expect(endButton(tree)).toHaveLength(0);
      expect(showsModuleOff(tree)).toBe(true);
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.runningSession);
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.start);
      act(() => tree.unmount());
    });

    it("keeps probing, but doesn't stack a refused heartbeat's line above the screen", async () => {
      api.heartbeat.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(api.heartbeat).toHaveBeenCalled();
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.session);
      expect(occurrences(tree, MODULE_OFF_COPY.runningSession)).toBe(1);
      act(() => tree.unmount());
    });

    it("brings the card back, with the refused write's line, once the payload says hours is on", async () => {
      api.heartbeat.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      chapter = HOURS_ON;
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <StudyScreen />
          </FrappThemeProvider>,
        ),
      );

      // The last beat really was refused, so the line is true again once the
      // card it describes is back.
      expect(endButton(tree)).toHaveLength(1);
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.session);
      expect(showsModuleOff(tree)).toBe(false);
      act(() => tree.unmount());
    });

    it("hides a subscription refusal's line too, rather than stack it above the screen", async () => {
      // The guard checks the subscription before the module, so a chapter
      // with both problems answers every write with the subscription refusal.
      api.heartbeat.mockRejectedValue(REFUSED);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(api.heartbeat).toHaveBeenCalled();
      expect(screenText(tree)).not.toContain(
        SUBSCRIPTION_REFUSAL_COPY.studySession,
      );
      expect(screenText(tree)).toContain(MODULE_OFF_COPY.runningSession);
      act(() => tree.unmount());
    });

    it("refetches the payload when a heartbeat gets through under the screen, which brings the card back", async () => {
      // An officer turned hours back on, but this payload is cached for five
      // minutes and the tab is never unmounted.
      api.heartbeat.mockResolvedValue(LIVE_SESSION[0]);
      refetchChapter.mockImplementation(async () => {
        chapter = HOURS_ON;
      });
      const tree = render();
      expect(endButton(tree)).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      expect(refetchChapter).toHaveBeenCalledTimes(1);
      rerender(tree);

      expect(endButton(tree)).toHaveLength(1);
      expect(showsModuleOff(tree)).toBe(false);
      act(() => tree.unmount());
    });

    it("doesn't refetch on a refusal the payload already agrees with", async () => {
      api.heartbeat.mockRejectedValue(MODULE_OFF);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(api.heartbeat).toHaveBeenCalled();
      expect(refetchChapter).not.toHaveBeenCalled();
      act(() => tree.unmount());
    });

    it("says the plain module-off line once the server says the session is gone", async () => {
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

      expect(screenText(tree)).toContain(MODULE_OFF_COPY.start);
      expect(screenText(tree)).not.toContain(MODULE_OFF_COPY.runningSession);
      act(() => tree.unmount());
    });

    it("reads the ended notice out above the screen, as a card would", async () => {
      // No card here, but the line is the same outcome a card announces.
      api.heartbeat.mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();
      sessions = NO_SESSIONS;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      const notice = tree.root.find(
        (node) =>
          node.type === ("Text" as never) &&
          drawnText(node).startsWith(
            "That session has already been closed somewhere else.",
          ),
      );
      expect(notice.props.accessibilityLiveRegion).toBe("polite");
      expect(showsModuleOff(tree)).toBe(true);
      act(() => tree.unmount());
    });
  });
});

describe("Study pull-to-refresh (#3385)", () => {
  it("refreshes the chapter, its zones and the member's sessions on a pull (#3385)", async () => {
    const tree = render();
    // The stand-in ScrollView doesn't draw its `refreshControl`, so this calls
    // the `refresh` that element was handed.
    const scroll = tree.root.find(
      (node) =>
        node.type === ("ScrollView" as never) &&
        node.props.refreshControl != null,
    );
    refetchChapter.mockClear();
    refetchZones.mockClear();
    refetchSessions.mockClear();
    await act(async () => {
      await scroll.props.refreshControl.props.refresh();
    });

    expect(refetchChapter).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetchZones).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetchSessions).toHaveBeenCalledWith({ cancelRefetch: true });
    act(() => tree.unmount());
  });
});

/** #3022. s10 opens from More's Study hours row and draws `‹ More`. */
describe("Study back row (#3022)", () => {
  it("draws ‹ More above the title", () => {
    const tree = render();
    expectBackRow(tree, "More", "/more");
    tree.unmount();
  });
});

/** A finished session in `zoneId`, as the history list reads it. */
function finished(id: string, zoneId: string, startTime: string) {
  return {
    id,
    geofence_id: zoneId,
    status: "COMPLETED",
    start_time: startTime,
    end_time: startTime,
    total_foreground_minutes: 45,
  };
}

/** The zone the Start card names, off its zone row's label. */
const selectedZoneLabel = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      typeof node.props.accessibilityLabel === "string" &&
      /study zone/i.test(node.props.accessibilityLabel),
  ).props.accessibilityLabel as string;

describe("Study's default zone", () => {
  it("opens on the zone of the member's last session, with Start ready", () => {
    // Waiting for a choice opened every two-zone chapter on "Pick a zone" over
    // a disabled Start, the screen's one action dead on arrival.
    zones = TWO_ZONES;
    sessions = [
      finished("s-new", "zone-1", "2026-09-27T10:00:00Z"),
      finished("s-old", "zone-2", "2026-09-20T10:00:00Z"),
    ];
    const tree = render();

    expect(selectedZoneLabel(tree)).toBe("Study zone: Library");
    expect(startButton(tree).props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain("Pick a zone");
    act(() => tree.unmount());
  });

  it("opens on the first zone when there is no history", () => {
    zones = TWO_ZONES;
    const tree = render();

    expect(selectedZoneLabel(tree)).toBe("Study zone: Commons");
    expect(startButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("falls back to the first zone when the last session's zone is gone", () => {
    zones = TWO_ZONES;
    sessions = [finished("s-1", "zone-retired", "2026-09-27T10:00:00Z")];
    const tree = render();

    expect(selectedZoneLabel(tree)).toBe("Study zone: Commons");
    act(() => tree.unmount());
  });

  it("waits for the history before choosing, so the last zone isn't beaten by the first", () => {
    zones = TWO_ZONES;
    sessions = [finished("s-1", "zone-1", "2026-09-27T10:00:00Z")];
    sessionsLoading = true;
    const tree = render();

    sessionsLoading = false;
    rerender(tree);

    expect(selectedZoneLabel(tree)).toBe("Study zone: Library");
    act(() => tree.unmount());
  });

  it("waits through a failed history read, so the retry's last zone still wins", () => {
    // A failed read isn't pending either. Choosing then put the first zone in
    // place, and a valid selection is kept, so the last zone never took over.
    zones = TWO_ZONES;
    sessions = [finished("s-1", "zone-1", "2026-09-27T10:00:00Z")];
    sessionsFailed = true;
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load study hours");

    sessionsFailed = false;
    rerender(tree);

    expect(selectedZoneLabel(tree)).toBe("Study zone: Library");
    act(() => tree.unmount());
  });

  it("offers the zone of a session that ends on screen, not the one picked before it ran", async () => {
    // Relaunched mid-session in Commons, with the last finished one in
    // Library: the history holds finished sessions only, so Library was
    // chosen under the running card, and a valid choice is kept.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
      zones = TWO_ZONES;
      const running = { ...LIVE_SESSION[0]!, geofence_id: "zone-2" };
      const library = finished("s-lib", "zone-1", "2026-09-26T10:00:00Z");
      sessions = [running, library];
      api.heartbeat.mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();

      // Closed elsewhere: the next beat 404s, and the list now has it closed.
      sessions = [{ ...running, status: "COMPLETED" }, library];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      rerender(tree);

      expect(selectedZoneLabel(tree)).toBe("Study zone: Commons");
      act(() => tree.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the choice it had when the ended session's zone is gone", async () => {
    // An officer deactivated Annex while the session ran in it. Offering
    // Annex would name a zone the list no longer has, and Start would post
    // its id.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T12:01:00Z"));
      const annex = { id: "zone-3", name: "Annex", is_active: true };
      zones = [...TWO_ZONES, annex];
      const running = { ...LIVE_SESSION[0]!, geofence_id: "zone-3" };
      const library = finished("s-lib", "zone-1", "2026-09-26T10:00:00Z");
      sessions = [running, library];
      api.heartbeat.mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();

      zones = TWO_ZONES;
      rerender(tree);
      sessions = [{ ...running, status: "COMPLETED" }, library];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });
      rerender(tree);

      expect(selectedZoneLabel(tree)).toBe("Study zone: Library");
      expect(startButton(tree).props.disabled).toBe(false);
      act(() => tree.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the member's own pick", () => {
    zones = TWO_ZONES;
    const tree = render();
    expect(selectedZoneLabel(tree)).toBe("Study zone: Commons");

    act(() => tree.root.findByType(ZonePickerSheet).props.onSelect("zone-1"));
    rerender(tree);

    expect(selectedZoneLabel(tree)).toBe("Study zone: Library");
    act(() => tree.unmount());
  });
});

describe("Study says where you are before Start", () => {
  /** A square about 110 m on a side, south-west corner at (lat, lng). */
  const square = (lat: number, lng: number) => [
    { lat, lng },
    { lat: lat + 0.001, lng },
    { lat: lat + 0.001, lng: lng + 0.001 },
    { lat, lng: lng + 0.001 },
  ];
  /** Library is alphabetically second, and about 1 km north of Commons. */
  const MAPPED = [
    { id: "zone-1", name: "Library", is_active: true, coordinates: square(42.74, -73.68) },
    { id: "zone-2", name: "Commons", is_active: true, coordinates: square(42.73, -73.68) },
  ];
  const IN_LIBRARY = { lat: 42.7405, lng: -73.6795 };

  async function settle() {
    await act(async () => {});
  }

  it("picks the zone the member is standing in and says so", async () => {
    zones = MAPPED;
    vi.mocked(readForegroundFix).mockResolvedValue(IN_LIBRARY);
    const tree = render();
    await settle();

    expect(selectedZoneLabel(tree)).toBe("Study zone: Library, You're here");
    expect(drawnText(tree.root.findByType(StartCard))).toContain("You're here");
    act(() => tree.unmount());
  });

  it("shows the distance on the card before the tap", async () => {
    zones = MAPPED;
    // Just south of Commons, so Commons is nearest.
    vi.mocked(readForegroundFix).mockResolvedValue({ lat: 42.7295, lng: -73.6795 });
    const tree = render();
    await settle();

    expect(selectedZoneLabel(tree)).toBe("Study zone: Commons, 200 ft away");
    act(() => tree.unmount());
  });

  it("lists the zones nearest first in the picker", async () => {
    zones = MAPPED;
    vi.mocked(readForegroundFix).mockResolvedValue(IN_LIBRARY);
    const tree = render();
    await settle();

    const radios = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.type === ("Pressable" as never),
    );
    expect(radios.map((node) => node.props.accessibilityLabel)).toEqual([
      "Library, You're here",
      "Commons, 0.7 mi away",
    ]);
    act(() => tree.unmount());
  });

  it("keeps a zone picked by hand when the next fix lands", async () => {
    vi.useFakeTimers();
    try {
      zones = MAPPED;
      vi.mocked(readForegroundFix).mockResolvedValue(IN_LIBRARY);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => tree.root.findByType(ZonePickerSheet).props.onSelect("zone-2"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });

      expect(selectedZoneLabel(tree)).toMatch(/^Study zone: Commons/);
      act(() => tree.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it("never asks for location on arrival", async () => {
    zones = MAPPED;
    vi.mocked(requestForegroundPermission).mockClear();
    vi.mocked(readForegroundFix).mockClear();
    vi.mocked(readForegroundPermission).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });
    const tree = render();
    await settle();

    expect(requestForegroundPermission).not.toHaveBeenCalled();
    expect(readForegroundFix).not.toHaveBeenCalled();
    expect(drawnText(tree.root.findByType(StartCard))).not.toContain("away");
    act(() => tree.unmount());
  });
});

describe("Study loading and empty states", () => {
  it("loads as the card and the list it becomes, not one card of bars", () => {
    isLoading = true;
    const tree = render();

    expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
    expect(tree.root.findAllByType(SkeletonLines)).toHaveLength(0);
    // The start card's own skeleton, so the card doesn't grow in on load.
    expect(tree.root.findAllByType(StartCardSkeleton)).toHaveLength(1);
    // Its writing.md row, without the ellipsis, as the region's name.
    expect(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.accessibilityRole === "progressbar",
      ).props.accessibilityLabel,
    ).toBe("Loading study zones");
    act(() => tree.unmount());
  });

  it("tells a member with no zones who to ask, without a permission key", () => {
    zones = [];
    const tree = render();

    expect(screenText(tree)).toContain(
      "No study zones yet. An officer adds them.",
    );
    expect(screenText(tree)).not.toContain("geofences:manage");
    act(() => tree.unmount());
  });

  it("tells an officer who manages zones where to add one", () => {
    zones = [];
    permissions = ["geofences:manage"];
    try {
      const tree = render();
      expect(screenText(tree)).toContain(
        "No study zones yet. Add one from Frapp on the web.",
      );
      act(() => tree.unmount());
    } finally {
      permissions = [];
    }
  });
});

describe("Study when location can't be read", () => {
  const platform = Platform as { OS: string; Version?: string | number };
  const { OS: os, Version: version } = platform;
  afterEach(() => {
    platform.OS = os;
    platform.Version = version;
  });

  async function failedLocationLine(on: string, osVersion: string | number) {
    platform.OS = on;
    platform.Version = osVersion;
    const tree = render();
    // After the mount: opening the screen reads the permission too, to say
    // how far each zone is, and that read must not take the Start tap's.
    await act(async () => {});
    vi.mocked(readForegroundPermission).mockRejectedValueOnce(
      new Error("location unavailable"),
    );
    await tapStart(tree);
    const text = drawnText(tree.root.findByType(StartCard));
    act(() => tree.unmount());
    return text;
  }

  it("spells out the iOS path on iPhone", async () => {
    const line = await failedLocationLine("ios", "18.1");
    expect(line).toContain("Turn it on in Settings → Apps → Frapp → Location.");
  });

  it("skips the Apps row before iOS 18, which has none", async () => {
    // This line has no Open Settings button, so a row that isn't there is a
    // dead end.
    const line = await failedLocationLine("ios", "17.5.1");
    expect(line).toContain("Turn it on in Settings → Frapp → Location.");
  });

  it("spells out Android's own path on Android", async () => {
    // The iOS path was all this said, and Android has no such screen.
    const line = await failedLocationLine("android", 34);
    expect(line).toContain(
      "Turn it on in Settings → Apps → Frapp → Permissions → Location.",
    );
  });

  it("points at the browser on the web build, which has no Settings path", async () => {
    // react-native-web's Platform.Version is "0.0.0", which read as iOS 0.
    const line = await failedLocationLine("web", "0.0.0");
    expect(line).toContain(
      "so it needs location while you study. Allow location for this site in your browser.",
    );
    expect(line).not.toContain("Settings →");
  });
});

describe("Study's notice and failure lines", () => {
  it("draws a failed Start inside the Start card, not above it", async () => {
    api.start.mockRejectedValue(FAILED);
    const tree = render();
    await tapStart(tree);

    const copy = startErrorCopy(FAILED);
    expect(drawnText(tree.root.findByType(StartCard))).toContain(copy);
    expect(occurrences(tree, copy)).toBe(1);
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

    it("draws a refused heartbeat's line inside the session card", async () => {
      api.heartbeat.mockRejectedValue(REFUSED);
      const tree = render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(drawnText(tree.root.findByType(SessionCard))).toContain(
        SUBSCRIPTION_REFUSAL_COPY.studySession,
      );
      expect(occurrences(tree, SUBSCRIPTION_REFUSAL_COPY.studySession)).toBe(1);
      act(() => tree.unmount());
    });

    it("hands the closed-elsewhere notice to the Start card that replaces the session", async () => {
      api.heartbeat.mockRejectedValue({ statusCode: 404, error: "Not Found" });
      const tree = render();
      sessions = NO_SESSIONS;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
      });

      expect(drawnText(tree.root.findByType(StartCard))).toContain(
        "That session has already been closed somewhere else.",
      );
      act(() => tree.unmount());
    });
  });
});
