/**
 * The web first-run tour (`spec/behavior/onboarding.md` § First-run tour (web),
 * #5080): six stops over the real Chat screen, in place of the slideshow of
 * glyph-and-sentence dialogs it replaced. The phone's tour
 * (`apps/mobile/lib/onboarding/tour.ts`) is the model: the screen dims except
 * one real control, a coach mark beside it says one thing about it, and a stop
 * whose control isn't on screen is skipped.
 *
 * Nothing here draws. Each stop names the controls it may point at, in order of
 * preference, by attributes the real UI already carries (`data-channel-list`,
 * `data-nav-section`, `data-nav-item`, `data-nav-trigger`, `data-account-menu`,
 * `#chat-timeline`), so a redesign that moves a control moves its stop with it.
 * Copy: `spec/ui/design-system/writing.md` § First-run tour (web).
 */

import { PICK_ROLES_COPY } from "@repo/validation";
import {
  DISPLAY_STEP_DESCRIPTION,
  DISPLAY_STEP_TITLE,
} from "@/components/onboarding/display-step";

/**
 * Where Replay tour lives (`account-section.tsx`), named wherever the tour
 * tells a member how to get it back (#5079).
 */
const REPLAY_LOCATION = "Settings → Account";

export const TOUR_SKIP_LABEL = "Skip tour";
export const TOUR_BACK_LABEL = "Back";
export const TOUR_NEXT_LABEL = "Next";
export const TOUR_DONE_LABEL = "Done";
export const TOUR_SKIPPED_TOAST = {
  title: "Tour skipped",
  description: `Replay it anytime from ${REPLAY_LOCATION}.`,
} as const;

export type TourStopKey =
  | "channels"
  | "display"
  | "roles"
  | "chapter"
  | "direct"
  | "account";

/** One control a stop may point at. */
interface TourAnchor {
  selector: string;
  /** Narrows the selector's matches, for a control named only by its text. */
  match?: (element: Element) => boolean;
  /** The element to light, when it isn't the match itself. */
  target?: (element: Element) => Element;
  /** The line to say when the stop lands on this control instead of the first. */
  text?: string;
}

export interface TourStop {
  key: TourStopKey;
  /** Only on a stop that carries a pick; elsewhere the lit control is the subject. */
  title?: string;
  /** One line. `{chapter}` is the chapter's name. */
  text: string;
  /** Tried in order; the first one on screen is the stop's spot. */
  anchors: readonly TourAnchor[];
  /**
   * The tallest the spot may be. A channel list can run the whole window; its
   * first rows are the point, and the coach mark needs room beside them.
   */
  maxHeight?: number;
}

const CHANNEL_LIST = '[data-channel-list="channels"]';
const BACK_TO_CHANNELS = 'button[aria-label="Back to channels"]';
/** Below `lg` the sidebar lives in the drawer this button opens. */
const MENU_BUTTON = "[data-nav-trigger]";

/** A category's list whose heading reads "Committees" (`channel-list.tsx`). */
const isCommitteesList = (element: Element) => {
  const headingId = element.getAttribute("aria-labelledby");
  const heading = headingId ? element.ownerDocument.getElementById(headingId) : null;
  return (
    heading?.textContent?.trim().toLowerCase().startsWith("committees") ?? false
  );
};

/** Every stop, in order. `roles` is in only for a member with a role to join. */
export const TOUR_STOPS: readonly TourStop[] = [
  {
    key: "channels",
    text: "You're in {chapter}. These are the chapter's channels. Click one to start talking.",
    anchors: [
      { selector: CHANNEL_LIST },
      // Below the side-by-side width chat opens on a channel, with the list
      // one step back (`chat-shell.tsx`'s narrow back button).
      {
        selector: BACK_TO_CHANNELS,
        text: "You're in {chapter}. The chapter's channels are one tap back, here.",
      },
    ],
    maxHeight: 320,
  },
  {
    // The display pick a member makes while setting up (#3787), over the real
    // messages so the thread itself shows what each choice does. Below the
    // side-by-side width the thread isn't on screen beside the list, so it
    // points at the list rather than leave the pick out.
    key: "display",
    title: DISPLAY_STEP_TITLE,
    text: DISPLAY_STEP_DESCRIPTION,
    anchors: [{ selector: "#chat-timeline" }, { selector: CHANNEL_LIST }],
  },
  {
    // Each role adds its channels (#4958), so the stop points where they land:
    // the chapter's Committees group when it has one, else the channel list.
    key: "roles",
    title: PICK_ROLES_COPY.title,
    text: PICK_ROLES_COPY.lede,
    anchors: [
      {
        selector: 'ul[aria-labelledby^="channel-section:"]',
        match: isCommitteesList,
        // The heading and its rows together: the list's block.
        target: (element) => element.parentElement ?? element,
      },
      { selector: CHANNEL_LIST },
    ],
    maxHeight: 320,
  },
  {
    key: "chapter",
    text: "Events, points, study hours and the rest of the chapter are here, under Chapter.",
    anchors: [
      { selector: '[data-nav-section="chapter"]' },
      {
        selector: MENU_BUTTON,
        text: "Events, points, study hours and the rest of the chapter are in this menu, under Chapter.",
      },
    ],
  },
  {
    key: "direct",
    text: "Direct messages are here.",
    anchors: [
      { selector: '[data-nav-item="direct"]' },
      { selector: MENU_BUTTON, text: "Direct messages are in this menu too." },
    ],
  },
  {
    key: "account",
    text: `Your profile and settings are here. Replay this tour anytime from ${REPLAY_LOCATION}.`,
    anchors: [{ selector: "[data-account-menu]" }],
  },
];

/** The stops this member gets, `Pick your roles` only with a role to join. */
export function tourStops(offerRoles: boolean): readonly TourStop[] {
  return offerRoles
    ? TOUR_STOPS
    : TOUR_STOPS.filter((stop) => stop.key !== "roles");
}

/** Where a stop sits in the full order, roles included. */
export function tourOrder(key: TourStopKey): number {
  return TOUR_STOPS.findIndex((stop) => stop.key === key);
}

export function tourStopText(
  text: string,
  chapterName: string | null | undefined,
): string {
  return text.replace("{chapter}", chapterName || "your chapter");
}

/** "1 of 5", counted over the stops this member will actually see. */
export function tourProgressLabel(index: number, count: number): string {
  return `${index + 1} of ${count}`;
}

/**
 * Where the tour starts: the stop it was paused on, or the first stop after
 * it when that one is no longer in (a roles stop whose roles are gone).
 */
export function resumeIndex(
  stops: readonly TourStop[],
  saved: TourStopKey | null,
): number {
  if (!saved) return 0;
  const order = tourOrder(saved);
  const index = stops.findIndex((stop) => tourOrder(stop.key) >= order);
  return index === -1 ? 0 : index;
}

/**
 * The stop to show from `from`, moving `step` (+1 or -1) past any whose
 * control isn't on screen. `null` when none is left that way.
 */
export function nextPresentIndex(
  stops: readonly TourStop[],
  from: number,
  step: 1 | -1,
  isPresent: (stop: TourStop) => boolean,
): number | null {
  for (let i = from; i >= 0 && i < stops.length; i += step) {
    if (isPresent(stops[i]!)) return i;
  }
  return null;
}

// ── Paused, per member and chapter ──────────────────────────────────────────

/**
 * Escape, a click on the dim, leaving Chat or closing the tab pause the tour;
 * only Skip and Done end it. The stop it paused on is kept in this browser,
 * per member and chapter, so it picks up there on the next visit.
 */
export function tourStorageKey(userId: string, chapterId: string): string {
  return `frapp.web.tour-stop:${userId}:${chapterId}`;
}

const STOP_KEYS = new Set<string>(TOUR_STOPS.map((stop) => stop.key));

export function readTourStop(key: string): TourStopKey | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && STOP_KEYS.has(value) ? (value as TourStopKey) : null;
  } catch {
    return null;
  }
}

export function writeTourStop(key: string, stop: TourStopKey): void {
  try {
    window.localStorage.setItem(key, stop);
  } catch {
    // Storage off: the tour starts over on the next visit, nothing worse.
  }
}

export function clearTourStop(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

// ── Where the spot and the coach mark go ────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Room around the control inside the lit spot. */
const TOUR_SPOT_PADDING = 4;
/** Kept between the window's edge and the spot or the coach mark. */
export const TOUR_EDGE = 8;
/** Between the spot and the coach mark (the spotlight edge sits in it). */
export const TOUR_GAP = 12;

/**
 * The lit spot for a control: padded, no taller than the stop allows, and
 * kept inside the window. `null` when too little of it is on screen to point
 * at, which skips the stop (a control `display: none` measures 0×0).
 */
export function tourSpot(
  control: Rect,
  viewport: Viewport,
  maxHeight?: number,
): Rect | null {
  const left = Math.max(control.x - TOUR_SPOT_PADDING, TOUR_EDGE / 2);
  const right = Math.min(
    control.x + control.width + TOUR_SPOT_PADDING,
    viewport.width - TOUR_EDGE / 2,
  );
  const top = Math.max(control.y - TOUR_SPOT_PADDING, TOUR_EDGE / 2);
  let bottom = Math.min(
    control.y + control.height + TOUR_SPOT_PADDING,
    viewport.height - TOUR_EDGE / 2,
  );
  if (maxHeight !== undefined) bottom = Math.min(bottom, top + maxHeight);
  if (right - left < 16 || bottom - top < 16) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where the coach mark goes: beside the spot to the right, else the left,
 * else under it, else over it, and when none has room (a spot that fills the
 * window) over the spot's lower edge, so the pick is never off screen.
 */
export function coachPosition(
  spot: Rect,
  card: { width: number; height: number },
  viewport: Viewport,
): { left: number; top: number } {
  const clampX = (x: number) =>
    Math.min(Math.max(x, TOUR_EDGE), viewport.width - card.width - TOUR_EDGE);
  const clampY = (y: number) =>
    Math.min(
      Math.max(y, TOUR_EDGE),
      viewport.height - card.height - TOUR_EDGE,
    );
  const spotRight = spot.x + spot.width;
  const spotBottom = spot.y + spot.height;

  if (spotRight + TOUR_GAP + card.width + TOUR_EDGE <= viewport.width) {
    return { left: spotRight + TOUR_GAP, top: clampY(spot.y) };
  }
  if (spot.x - TOUR_GAP - card.width >= TOUR_EDGE) {
    return { left: spot.x - TOUR_GAP - card.width, top: clampY(spot.y) };
  }
  if (spotBottom + TOUR_GAP + card.height + TOUR_EDGE <= viewport.height) {
    return { left: clampX(spot.x), top: spotBottom + TOUR_GAP };
  }
  if (spot.y - TOUR_GAP - card.height >= TOUR_EDGE) {
    return { left: clampX(spot.x), top: spot.y - TOUR_GAP - card.height };
  }
  return {
    left: clampX(spot.x + (spot.width - card.width) / 2),
    top: clampY(spotBottom - card.height - TOUR_GAP),
  };
}

/**
 * The dim with the spot cut out, as one even-odd SVG path: the window, then
 * the spot as a rounded rectangle. Even-odd leaves the spot unfilled, and an
 * unfilled area takes no clicks, so the lit control stays usable through it.
 */
export function scrimPath(
  spot: Rect,
  viewport: Viewport,
  radius = 10,
): string {
  const r = Math.min(radius, spot.width / 2, spot.height / 2);
  const { x, y, width: w, height: h } = spot;
  return [
    `M0 0H${viewport.width}V${viewport.height}H0Z`,
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join("");
}

/** The first match of a stop's anchors that is on screen, and its spot. */
export function locateStop(
  stop: TourStop,
  root: ParentNode,
  viewport: Viewport,
): { spot: Rect; text: string } | null {
  for (const anchor of stop.anchors) {
    for (const element of Array.from(root.querySelectorAll(anchor.selector))) {
      if (anchor.match && !anchor.match(element)) continue;
      const box = (anchor.target?.(element) ?? element).getBoundingClientRect();
      const spot = tourSpot(
        { x: box.left, y: box.top, width: box.width, height: box.height },
        viewport,
        stop.maxHeight,
      );
      if (spot) return { spot, text: anchor.text ?? stop.text };
    }
  }
  return null;
}
