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
import { InlineNote } from "@/components/inline-note";
import { screenText } from "@/test/screen-text";

/**
 * s06, rendered. It renders `app/(app)/(tabs)/events.tsx` but lives here: a spec
 * under `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const START = new Date("2026-09-25T18:00:00Z");
// A minute before check-in opens, ten minutes before the start.
const MOUNTED_AT = new Date(START.getTime() - 11 * 60_000);
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
let permissions: string[] = [];
const refetch = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useListChapters: () => ({ data: [{ chapter_id: "chapter-1", role_ids: [] }] }),
  useEvents: () => ({ ...query, data: events, refetch }),
  usePermissionList: () => permissions,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: ACCENT,
    accentSubtle: "#251E0E",
    accentBorder: "#6B5619",
  }),
}));

vi.mock("@/lib/ask/flag", () => ({ isAskAvailable: () => false }));

import EventsScreen from "@/app/(app)/(tabs)/events";

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

const createButton = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "New event" &&
      typeof node.props.onPress === "function",
  )[0];

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

  // foundations.md §6 "Where the accent goes" (2026-11-05): a date label is a
  // label, so it is neutral: "Today" in the foreground, any other day muted.
  it("draws the date block's label neutral over the day, never the accent", () => {
    const tree = render();
    // Mounted a minute before the event, which is the same local day in most
    // zones but the day before in some (UTC+6 puts the start at midnight), so
    // the label comes from the formatter, which format.spec.ts pins.
    const block = formatEventDateBlock(START.toISOString(), MOUNTED_AT);
    const color = styleOf(tree, block!.label).color;
    expect(color).toBe(
      block!.isToday
        ? signetDarkTokens.color.text.foreground
        : signetDarkTokens.color.text.mutedForeground,
    );
    expect(color).not.toBe(ACCENT);
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

    // Danger text in its AA lift (components.md §5), the tint keeps the hue.
    expect(styleOf(tree, "Mandatory").color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
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

    expect(screenText(tree)).toContain("Choose a chapter from More");
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

  it("refreshes the events on a pull (#3385)", async () => {
    refetch.mockClear();
    const tree = render();

    // The scroll view is a string host here, so it never renders its control.
    // The control is read off its prop instead, and its refresh is the pull.
    const [scroll] = tree.root.findAllByType(
      "ScrollView" as unknown as React.ElementType,
    );
    const control = scroll.props.refreshControl as
      React.ReactElement<{ refresh: () => Promise<unknown> }> | undefined;
    expect(control).toBeDefined();
    await act(async () => {
      await control!.props.refresh();
    });

    expect(refetch).toHaveBeenCalledWith({ cancelRefetch: true });
  });

  it("keeps the pull with no chapter, so a chapter arriving never remounts the list (#3385)", () => {
    // Adding or removing a scroll view's refreshControl rebuilds everything
    // under it, so the control must not follow the chapter claim.
    chapterId = null;
    query = { isPending: true, isError: false, isFetching: false };
    const tree = render();
    const [scroll] = tree.root.findAllByType(
      "ScrollView" as unknown as React.ElementType,
    );

    expect(scroll.props.refreshControl).toBeDefined();
  });

  it("points an officer at the tab bar's + when nothing is scheduled", () => {
    // An owner's grant is the wildcard.
    permissions = ["*"];
    events = [];
    const tree = render();

    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    // New event lives in the quick actions now, so the screen draws no + of
    // its own beside the tab bar's.
    expect(createButton(tree)).toBeUndefined();
    permissions = [];
  });

  it("says nothing about + to a role whose every create would be refused", () => {
    // `POST /v1/events` also needs the controller's `members:view`.
    permissions = ["events:create"];
    events = [];
    const tree = render();

    expect(screenText(tree)).not.toContain("Tap +");
    permissions = [];
  });

  it("says nothing about + to a member", () => {
    permissions = [];
    events = [];
    const tree = render();

    expect(createButton(tree)).toBeUndefined();
    expect(screenText(tree)).not.toContain("Tap +");
  });

  it("says nothing is scheduled without narrating the screen", () => {
    events = [];
    const tree = render();

    expect(screenText(tree)).toContain("Nothing scheduled yet.");
    expect(screenText(tree)).not.toContain("will appear here");
  });

  it("says it in one line where the rows go, not a card", () => {
    events = [];
    const tree = render();

    expect(tree.root.findAllByType(InlineNote)).toHaveLength(1);
  });
});

/**
 * The owner's 2026-11-05 pick: the next event is the page's one card, and the
 * rest sit flush on the floor in "This week" and "Later" groups, with points in
 * the meta line as web writes them.
 */
describe("Events after the first", () => {
  const at = (days: number) => new Date(START.getTime() + days * 86_400_000);
  const make = (id: string, days: number, extra: object = {}) => ({
    ...EVENT,
    id,
    name: `Event ${id}`,
    start_time: at(days).toISOString(),
    end_time: new Date(at(days).getTime() + 3_600_000).toISOString(),
    ...extra,
  });

  it("groups the rest into this week and later", () => {
    events = [
      make("a", 0),
      make("b", 2),
      make("c", 10, { point_value: 15, location: "Library" }),
    ];
    const text = screenText(render());
    expect(text.indexOf("This week")).toBeGreaterThan(text.indexOf("Event a"));
    expect(text.indexOf("Event b")).toBeGreaterThan(text.indexOf("This week"));
    expect(text.indexOf("Later")).toBeGreaterThan(text.indexOf("Event b"));
    expect(text.indexOf("Event c")).toBeGreaterThan(text.indexOf("Later"));
    expect(text).toMatch(/Library · 15 pts/);
    expect(text).not.toContain("+15 pts");
  });

  it("draws a later row with no card fill and Mandatory in danger", () => {
    events = [make("a", 0), make("b", 2, { is_mandatory: true })];
    const tree = render();
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Open Event b",
    );
    const resting = StyleSheet.flatten(row.props.style({ pressed: false }));
    expect(resting.backgroundColor).toBeUndefined();
    expect(resting.borderRadius).toBeUndefined();
    const chip = row.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === "Mandatory",
    );
    expect(StyleSheet.flatten(chip.props.style).color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
    );
  });

  it("splits rows by hairlines, none above a group's first, and bleeds into the gutter", () => {
    events = [make("a", 0), make("b", 2), make("c", 3)];
    const tree = render();
    const pressableOf = (name: string) =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === `Open ${name}`,
      );
    const restingOf = (name: string) =>
      StyleSheet.flatten(pressableOf(name).props.style({ pressed: false }));
    const first = restingOf("Event b");
    expect(first.borderTopWidth).toBeUndefined();
    expect(restingOf("Event c").borderTopWidth).toBeGreaterThan(0);
    // The row pads by `sm` and its clip pulls that back into the gutter.
    expect(first.paddingHorizontal).toBe(signetDarkTokens.spacing.sm);
    const clip = StyleSheet.flatten(pressableOf("Event b").parent!.props.style);
    expect(clip.marginHorizontal).toBe(-signetDarkTokens.spacing.sm);
  });
});
