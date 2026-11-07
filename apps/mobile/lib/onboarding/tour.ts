/**
 * The first-run tour (`spec/behavior/onboarding.md` § First-run tour): three
 * stops over the real tab screens, right after s03, in place of the static
 * "You're in." card that used to open s03 (owner brief 2026-11-07, item 4).
 *
 * The tour dims the screen except one spot, says one line about it, and
 * moves on at a tap anywhere. It draws nothing of its own to keep in step
 * with the app: each stop is a spot the real UI marks with `TourAnchor`
 * (`components/onboarding/tour.tsx`), so a stop follows its control wherever
 * a redesign moves it, and a stop whose control isn't on screen is skipped.
 *
 * It runs once per member: s03 marks it due when the member leaves for chat
 * (`markTourDue`), and Skip or the last stop clears that for good. Nothing
 * else ever starts it, so a member who joined before it shipped never sees it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type TourStopKey = "channels" | "quickActions" | "more";

export interface TourStop {
  key: TourStopKey;
  /** One line. `{chapter}` is the chapter's name. */
  text: string;
  /**
   * The tallest the spot may be. The channel list can run the whole screen;
   * its first rows are the point, and the line needs room under them.
   */
  maxHeight?: number;
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    key: "channels",
    text: "You're in {chapter}. Tap a channel to start talking.",
    maxHeight: 220,
  },
  {
    key: "quickActions",
    text: "Shortcuts live under the +. Hold it to pick your own.",
  },
  {
    key: "more",
    text: "The directory, your hours and settings are in More.",
  },
];

export const TOUR_SKIP_LABEL = "Skip";
export const TOUR_NEXT_LABEL = "Next";
export const TOUR_DONE_LABEL = "Done";

export function tourStopText(stop: TourStop, chapterName: string | null) {
  return stop.text.replace("{chapter}", chapterName ?? "your chapter");
}

/** "1 of 3", counted over the stops this member will actually see. */
export function tourProgressLabel(index: number, count: number) {
  return `${index + 1} of ${count}`;
}

// ── Once per member ─────────────────────────────────────────────────────────

/** The id of the member the tour is due for, set by s03 on the way out. */
export const TOUR_DUE_STORAGE_KEY = "frapp.mobile.tour-due";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

/**
 * Marks the tour due for this member. Keyed by user id, so a second account
 * signed in on the same phone doesn't inherit someone else's tour.
 */
export async function markTourDue(
  userId: string,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(TOUR_DUE_STORAGE_KEY, userId);
  } catch {
    // No tour is the failure; the member still reaches chat.
  }
}

export async function isTourDue(
  userId: string,
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    return (await storage.getItem(TOUR_DUE_STORAGE_KEY)) === userId;
  } catch {
    return false;
  }
}

/** Skip, or the last stop: never again on this phone. */
export async function clearTourDue(
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.removeItem(TOUR_DUE_STORAGE_KEY);
  } catch {
    // It shows once more at worst.
  }
}

// ── Where the line goes ─────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room around the control inside the lit spot. */
export const TOUR_SPOT_PADDING = 6;

/**
 * The lit spot for a control measured in the window: padded, no taller than
 * the stop allows, and kept inside the visible band (under the status bar,
 * above the bottom inset). `null` when too little of it is on screen to point
 * at, which skips the stop.
 */
export function tourSpot(
  control: Rect,
  bounds: { top: number; bottom: number; width: number },
  maxHeight?: number,
): Rect | null {
  const left = Math.max(control.x - TOUR_SPOT_PADDING, 4);
  const right = Math.min(
    control.x + control.width + TOUR_SPOT_PADDING,
    bounds.width - 4,
  );
  const top = Math.max(control.y - TOUR_SPOT_PADDING, bounds.top);
  let bottom = Math.min(
    control.y + control.height + TOUR_SPOT_PADDING,
    bounds.bottom,
  );
  if (maxHeight !== undefined) bottom = Math.min(bottom, top + maxHeight);
  if (right - left < 24 || bottom - top < 24) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The line sits under a spot in the top half of the window, else over it. */
export function tourCalloutSide(
  spot: Rect,
  windowHeight: number,
): "below" | "above" {
  return spot.y + spot.height / 2 < windowHeight / 2 ? "below" : "above";
}

// ── Analytics ───────────────────────────────────────────────────────────────

/**
 * Sent once when the tour ends (`spec/behavior/observability.md` § Member
 * Onboarding Funnel). Shape only.
 */
export const ONBOARDING_TOUR_FINISHED_EVENT = "onboarding-tour-finished";

export function onboardingTourFinishedProperties(input: {
  skipped: boolean;
  /** 1-based: the stop the member was on when it ended. */
  stop: number;
  stops: number;
}): { outcome: "done" | "skipped"; stop: number; stops: number } {
  return {
    outcome: input.skipped ? "skipped" : "done",
    stop: input.stop,
    stops: input.stops,
  };
}
