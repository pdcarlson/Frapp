/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { formatEventDateBlock } from "@/lib/events/format";
import { expectRoundedRipple } from "@/test/pressable-row";
import { screenText } from "@/test/screen-text";

/**
 * s06, rendered. It renders `app/(tabs)/events.tsx` but lives here: a spec
 * under `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const START = new Date("2026-09-25T18:00:00Z");
const MOUNTED_AT = new Date(START.getTime() - 60_000);
const ACCENT = "#DDB844";

const EVENT = {
  id: "evt-1",
  name: "Chapter meeting",
  location: null as string | null,
  start_time: START.toISOString(),
  end_time: new Date(START.getTime() + 60 * 60_000).toISOString(),
  point_value: null as number | null,
  is_mandatory: false,
};

let events: unknown[] = [EVENT];
let chapterId: string | null = "chapter-1";
let query = { isPending: false, isError: false, isFetching: false };
const refetch = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useEvents: () => ({ ...query, data: events, refetch }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: ACCENT,
    accentSubtle: "#251E0E",
    accentBorder: "#6B5619",
  }),
}));

vi.mock("@/lib/ask/flag", () => ({ isAskAvailable: () => false }));

import EventsScreen from "@/app/(tabs)/events";

const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

/** The flattened style of the one `Text` that draws exactly `text`. */
function styleOf(tree: ReactTestRenderer, text: string): TextStyle {
  const [node] = tree.root
    .findAllByType("Text" as never)
    .filter((candidate) => candidate.props.children === text);
  if (!node) throw new Error(`no Text draws ${JSON.stringify(text)}`);
  return StyleSheet.flatten(node.props.style) as TextStyle;
}

const skeletons = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.accessibilityRole === "progressbar");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MOUNTED_AT);
  events = [EVENT];
  chapterId = "chapter-1";
  query = { isPending: false, isError: false, isFetching: false };
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  vi.useRealTimers();
});

/**
 * #2101. s06 used to capture `now` once per mount, in a memo with no
 * dependencies, and a tab is never unmounted, so a check-in window that opened
 * while the list was on screen never showed as open, and a finished event
 * never fell off. This pins that the list reads the shared ticking clock.
 */
describe("Events list clock (#2101)", () => {
  it("opens a check-in window that starts while the list is on screen", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("Check-in is open");

    // Past the start, on the clock's own tick — no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("Check-in is open");
  });
});

describe("Event card", () => {
  it("leads with the name, not the place", () => {
    events = [{ ...EVENT, location: "Chapter House — Great Room" }];
    const tree = render();

    const name = styleOf(tree, "Chapter meeting");
    const meta = screenText(tree)
      .split("\n")
      .find((line) => line.endsWith("· Chapter House — Great Room"));
    expect(meta).toBeDefined();
    const place = styleOf(tree, meta as string);

    expect(name.fontSize).toBe(signetDarkTokens.typography.role.title.size);
    expect(Number(name.fontSize)).toBeGreaterThan(Number(place.fontSize));
    expect(place.color).toBe(signetDarkTokens.color.text.mutedForeground);
  });

  it("draws the date block in the chapter accent over the day", () => {
    const tree = render();
    // Mounted a minute before the event, which is the same local day in most
    // zones but the day before in some (UTC+6 puts the start at midnight), so
    // the label comes from the formatter, which format.spec.ts pins.
    const block = formatEventDateBlock(START.toISOString(), MOUNTED_AT);
    expect(styleOf(tree, block!.label).color).toBe(ACCENT);
    expect(screenText(tree)).toContain(String(START.getDate()));
  });

  it("answers a press with a lift and a ripple, not a fade", () => {
    const tree = render();
    const [card] = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Open Chapter meeting" &&
        typeof node.props.style === "function",
    );
    const held = StyleSheet.flatten(card.props.style({ pressed: true }));

    // The suite's stub is iOS: the card lifts one rung up the surface ladder.
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(held).not.toHaveProperty("opacity");
    // The ripple is rounded by a parent clip with the card's radius
    // (`PressableRow`); the card's own `overflow` would leave it square.
    const { clip } = expectRoundedRipple(
      card,
      signetDarkTokens.radius.cardLarge,
    );
    // The card has no margins, so the clip adds none and the card stays put.
    expect(Object.keys(clip).filter((key) => key.startsWith("margin"))).toEqual(
      [],
    );
  });

  it("paints Mandatory as a danger status and points in the accent", () => {
    events = [{ ...EVENT, is_mandatory: true, point_value: 10 }];
    const tree = render();

    expect(styleOf(tree, "Mandatory").color).toBe(
      signetDarkTokens.color.semantic.destructive,
    );
    expect(styleOf(tree, "+10 pts").color).toBe(ACCENT);
  });
});

/**
 * From the owner's 2026-11-04 Android test feedback: s06 carried its own
 * spinner-in-a-card state blocks, and with no active chapter `useEvents`
 * never runs, so the spinner never stopped.
 */
describe("Events list states", () => {
  it("asks for a chapter instead of loading forever without one", () => {
    chapterId = null;
    query = { isPending: true, isError: false, isFetching: false };
    const tree = render();

    expect(screenText(tree)).toContain("No chapter selected");
    expect(skeletons(tree)).toHaveLength(0);
  });

  it("draws the shared skeleton while loading", () => {
    query = { isPending: true, isError: false, isFetching: true };
    const tree = render();

    // One region, named for what loads, shaped as the event cards.
    expect(skeletons(tree)).toHaveLength(1);
    expect(skeletons(tree)[0]!.props.accessibilityLabel).toBe(
      "Loading chapter events",
    );
    expect(screenText(tree)).not.toMatch(/Loading/);
  });

  it("offers a retry on error", () => {
    query = { isPending: false, isError: true, isFetching: false };
    const tree = render();

    expect(screenText(tree)).toContain("Couldn't load events");
    const [retry] = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Try again" &&
        typeof node.props.onPress === "function",
    );
    act(() => retry.props.onPress());
    expect(refetch).toHaveBeenCalled();
  });

  it("says nothing is scheduled without narrating the screen", () => {
    events = [];
    const tree = render();

    expect(screenText(tree)).toContain("Nothing scheduled");
    expect(screenText(tree)).not.toContain("will appear here");
  });
});
