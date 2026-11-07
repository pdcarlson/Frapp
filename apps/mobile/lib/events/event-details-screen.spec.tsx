/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { StyleSheet } from "react-native";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { expectRoundedRipple } from "@/test/pressable-row";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s07 is often opened before check-in opens: a member arriving early
 * taps through from UP NEXT. A `new Date()` captured at mount left "Check-in
 * hasn't opened" on screen through the start and past the close, with no way
 * to the scanner but backing out. This pins that the screen reads the shared
 * ticking clock, as the Events list does (`events-screen.spec.tsx`), for both
 * of the things it works out from "now": the check-in card and the header's
 * "Tonight / Tomorrow" line.
 *
 * It renders `app/(app)/event-details.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const START = new Date("2026-09-25T18:00:00Z");
const MOUNTED_AT = new Date(START.getTime() - 60_000);

const ACCENT = "#DDB844";
const ACCENT_SUBTLE = "#251E0E";

const EVENT: Record<string, unknown> = {
  id: "evt-1",
  name: "Chapter meeting",
  location: null,
  start_time: START.toISOString(),
  end_time: new Date(START.getTime() + 60 * 60_000).toISOString(),
  point_value: null,
  is_mandatory: false,
};

let event = EVENT;
// Swapped by the back-row specs for s07's loading and no-event states.
let eventPending = false;
let routeId: string | undefined = EVENT.id as string;
let chapterId: string | null = "chapter-1";

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useListChapters: () => ({ data: [{ chapter_id: "chapter-1", role_ids: [] }] }),
  useEvent: () => ({
    isPending: eventPending,
    isError: false,
    isFetching: false,
    data: event,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: ACCENT,
    accentSubtle: ACCENT_SUBTLE,
    accentBorder: "#6B5619",
  }),
}));

// Real by default; the exporting spec holds one export open.
const exportCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar-export")>();
  exportCalendar.mockImplementation(actual.exportEventToCalendar);
  return { ...actual, exportEventToCalendar: exportCalendar };
});

vi.mocked(expoRouter.useLocalSearchParams).mockImplementation(
  (): Record<string, string> => (routeId === undefined ? {} : { id: routeId }),
);

import EventDetailsScreen from "@/app/(app)/event-details";

/**
 * Unmounted in `afterEach`, not at the end of each test: the shared clock is
 * module state, and a failed test's tree left subscribed would hold it at that
 * test's time for the next one.
 */
const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventDetailsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe("Event details clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
    event = EVENT;
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("opens check-in when the window opens while the screen is up", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("Check-in is open");

    // Past the start, on the clock's own tick: no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("Check-in is open");
  });

  it("turns tomorrow's event into tonight's at midnight while the screen is up", () => {
    // Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo,
    // and "tomorrow" is the member's own calendar day.
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    event = {
      ...EVENT,
      start_time: new Date(2026, 9, 1, 18, 0).toISOString(),
      end_time: new Date(2026, 9, 1, 19, 0).toISOString(),
    };
    const tree = render();
    expect(screenText(tree)).toMatch(/(^|\n)Tomorrow · /);

    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toMatch(/(^|\n)Tonight · /);
    expect(screenText(tree)).not.toContain("Tomorrow");
  });
});

/**
 * #3022. s07 draws `‹ Events` above the title, in every state: a notification
 * or a `frapp://` link can open an event that is gone, and the error screen
 * still needs a way out.
 */
describe("Event details back row (#3022)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    event = EVENT;
    eventPending = false;
    routeId = EVENT.id as string;
    chapterId = "chapter-1";
  });

  it("draws ‹ Events over a loaded event", () => {
    const tree = render();
    expect(screenText(tree).startsWith("Events\nChapter meeting")).toBe(true);
    expectBackRow(tree, "Events", "/events");
  });

  it("draws ‹ Events over the error state", () => {
    event = null as unknown as typeof EVENT;

    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load this event");
    expectBackRow(tree, "Events", "/events");
  });

  it("draws ‹ Events while the event loads", () => {
    eventPending = true;

    const tree = render();
    expect(skeletons(tree).length).toBeGreaterThan(0);
    expectBackRow(tree, "Events", "/events");
  });

  it("draws ‹ Events when the route carries no event id", () => {
    routeId = undefined;

    const tree = render();
    expect(screenText(tree)).toContain("Nothing to show");
    expectBackRow(tree, "Events", "/events");
  });

  /**
   * No "No chapter selected" branch: the API resolves a sole membership when
   * the token carries no `active_chapter_id` claim, so a member opening an
   * event from a push or a calendar link still gets it (study.tsx gives the
   * same reasoning).
   */
  it("still draws the event when no chapter is active", () => {
    chapterId = null;

    const tree = render();
    expect(screenText(tree)).not.toContain("No chapter selected");
    expect(screenText(tree).startsWith("Events\nChapter meeting")).toBe(true);
    expectBackRow(tree, "Events", "/events");
  });
});

/** The flattened style of `node`. */
const flat = (node: ReactTestInstance): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style);

const textNode = (tree: ReactTestRenderer, text: string) =>
  tree.root
    .findAllByType("Text" as never)
    .find((node) => node.props.children === text);

const skeletons = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.accessibilityRole === "progressbar");

/**
 * The owner's 2026-11-04 Android test feedback: the chips, the check-in card,
 * the narrating lines and the shared state family.
 */
describe("Event details layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Inside the check-in window.
    vi.setSystemTime(new Date(START.getTime() + 10 * 60_000));
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
    event = EVENT;
    chapterId = "chapter-1";
  });

  it("puts the place in the line under the title, not beside the chips", () => {
    event = {
      ...EVENT,
      location: "Chapter House — Great Room",
      is_mandatory: true,
      point_value: 10,
    };
    const tree = render();

    expect(screenText(tree)).toMatch(/· .+ · Chapter House — Great Room\n/);
    expect(textNode(tree, "Chapter House — Great Room")).toBeUndefined();
    expect(flat(textNode(tree, "Mandatory")!).color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
    );
    expect(flat(textNode(tree, "+10 pts")!).color).toBe(ACCENT);
  });

  it("draws the open card in the accent with the 48pt accent scan button", () => {
    const tree = render();

    expect(flat(textNode(tree, "Check-in is open")!).color).toBe(ACCENT);
    const card = tree.root.find(
      (node) =>
        typeof node.type === "string" &&
        flat(node).backgroundColor === ACCENT_SUBTLE,
    );
    expect(card).toBeDefined();

    const [scan] = tree.root.findAll(
      (node) =>
        typeof node.props.style === "function" &&
        node.findAll((text) => text.props.children === "Scan QR to check in")
          .length > 0,
    );
    const style = StyleSheet.flatten(scan.props.style({ pressed: false }));
    expect(style).toMatchObject({
      height: signetDarkTokens.touch.buttonLarge,
      borderRadius: signetDarkTokens.radius.control,
      backgroundColor: ACCENT,
    });
    expect(flat(textNode(tree, "Scan QR to check in")!).color).toBe(
      signetDarkTokens.color.gold.onHouse,
    );
  });

  /** The card's header row: the dot is the View drawn beside the title. */
  const dotColor = (tree: ReactTestRenderer, title: string) => {
    const node = textNode(tree, title);
    const dot = node!.parent!.children.find(
      (child): child is ReactTestInstance =>
        typeof child !== "string" && child !== node,
    );
    return flat(dot!).backgroundColor;
  };

  it("lights the open card's dot green", () => {
    expect(dotColor(render(), "Check-in is open")).toBe(
      signetDarkTokens.color.semantic.success,
    );
  });

  it("leaves a closed card's dot muted", () => {
    vi.setSystemTime(new Date(START.getTime() + 3 * 60 * 60_000));
    expect(dotColor(render(), "Check-in is closed")).toBe(
      signetDarkTokens.color.text.muted,
    );
  });

  it("draws Add to calendar at the scan button's height and radius", () => {
    const tree = render();
    const [button] = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Add this event to your calendar" &&
        typeof node.props.style === "function",
    );
    const rest = StyleSheet.flatten(button.props.style({ pressed: false }));
    const held = StyleSheet.flatten(button.props.style({ pressed: true }));

    expect(rest).toMatchObject({
      height: signetDarkTokens.touch.buttonLarge,
      borderRadius: signetDarkTokens.radius.control,
    });
    // Press feedback is a lift up the surface ladder (the stub is iOS) and a
    // ripple on Android, never an opacity fade.
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(held).not.toHaveProperty("opacity");
    // The ripple is rounded by a parent clip with the button's radius
    // (`PressableRow`); the button's own `overflow` would leave it square.
    expectRoundedRipple(button, signetDarkTokens.radius.control);
  });

  it("drops Add to calendar's ripple while it is exporting", () => {
    // The export never settles here, so the button stays in "Adding…".
    exportCalendar.mockReturnValueOnce(new Promise<boolean>(() => {}));
    const tree = render();
    const button = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityLabel === "Add this event to your calendar" &&
          typeof node.props.style === "function",
      );

    act(() => {
      button().props.onPress();
    });

    expect(screenText(tree)).toContain("Adding…");
    expect(button().props.disabled).toBe(true);
    expect(button().props.accessibilityState).toEqual({ disabled: true });
    expect(button().props.android_ripple).toBeUndefined();
  });

  it("says no more than the card does", () => {
    event = {
      ...EVENT,
      check_in_zone: [[0, 0]],
      check_in_zone_name: "Great Room",
    };
    const tree = render();

    expect(screenText(tree)).not.toContain("to be counted");
    const zone = textNode(tree, "Check in from inside the Great Room zone.");
    expect(zone).toBeDefined();
    // Not info blue: the board draws no semantic hue here.
    expect(flat(zone!).color).toBe(signetDarkTokens.color.text.mutedForeground);
  });

  it("says a closed window in one line", () => {
    vi.setSystemTime(new Date(START.getTime() + 3 * 60 * 60_000));
    const tree = render();

    expect(screenText(tree)).toContain("Check-in is closed");
    expect(screenText(tree)).not.toContain("window has ended");
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
  });
});
