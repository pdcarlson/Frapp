/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { HeaderButton } from "@/components/header-button";
import { DisclosureGlyph } from "@/components/control-glyphs";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EVENTS_VIEW_STORAGE_KEY,
  resetCalendarLayersForTests,
  resetEventsViewForTests,
} from "@/lib/events/events-view";
import { selectCalendarTasks } from "@repo/hooks/calendar-tasks";
import { localIsoDate } from "@repo/formatting";
import { expectRoundedRipple } from "@/test/pressable-row";
import { InlineNote } from "@/components/inline-note";
import { drawnText, screenText } from "@/test/screen-text";

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
const tasksRefetch = vi.fn();
let tasks: unknown[] = [];

const { eventAttendanceFor } = await vi.hoisted(
  async () => await import("@repo/validation"),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // A viewer with no roles: the hook reads the providers this spec doesn't mount.
  useRequiredOfViewer:
    () => (fields: Parameters<typeof eventAttendanceFor>[0]) =>
      eventAttendanceFor(fields, []).status === "required",
  useActiveChapterId: () => chapterId,
  useListChapters: () => ({
    data: [{ chapter_id: "chapter-1", role_ids: [] }],
  }),
  // A failed first read: nothing loaded. A failed refetch keeps its rows.
  useEvents: () => ({
    ...query,
    data: query.isError ? undefined : events,
    refetch,
  }),
  useTasks: () => ({ ...query, data: tasks, refetch: tasksRefetch }),
  useCalendarTasks: () => {
    const items = selectCalendarTasks(tasks, "me");
    return {
      items,
      hasMine: items.some((item) => item.kind === "mine"),
      hasAssigned: items.some((item) => item.kind === "assigned"),
    };
  },
  useChapterRoster: () => ({
    data: [
      { user_id: "m1", display_name: "Sam Lee" },
      { user_id: "m2", display_name: "Ana Ruiz" },
    ],
  }),
  useViewerUserId: () => "me",
  usePermissionList: () => permissions,
}));

// Its own spec covers it; here it would need the AI reads.
// The Subscribe sheet (#3322) has its own spec; here only its door matters.
// The sheet has its own spec; here only its door, so it records what the
// screen hands it.
const subscribeSheet = vi.hoisted(() => ({
  props: null as null | { open: boolean; onDismiss: () => void },
}));
vi.mock("@/components/events/calendar-subscribe-sheet", () => ({
  CalendarSubscribeSheet: (props: { open: boolean; onDismiss: () => void }) => {
    subscribeSheet.props = props;
    return null;
  },
}));
vi.mock("@/components/events/suggested-events-entry", () => ({
  SuggestedEventsEntry: () => null,
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: ACCENT,
    accentSubtle: "#251E0E",
    accentBorder: "#6B5619",
  }),
}));

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
  resetEventsViewForTests();
  resetCalendarLayersForTests();
  tasks = [];
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
// #3322: the header's Subscribe door. The sheet asks for a link only while
// `open`, so a member who never taps it never has one made.
describe("Events header Subscribe", () => {
  // #4610 step 3: a bare glyph beside the title was what "buttons are
  // unclear" meant. Every header action sits in the round Chat home drew.
  it("draws the door as a round header button", () => {
    const labels = render()
      .root.findAllByType(HeaderButton)
      .map((node) => node.props.label);
    expect(labels).toEqual(["Subscribe to events in your calendar"]);
  });

  it("opens the sheet from the header and closes it on dismiss", () => {
    const tree = render();
    expect(subscribeSheet.props?.open).toBe(false);
    const door = tree.root.find(
      (node) =>
        node.props.accessibilityLabel ===
          "Subscribe to events in your calendar" &&
        typeof node.props.onPress === "function",
    );
    act(() => door.props.onPress());
    expect(subscribeSheet.props?.open).toBe(true);
    act(() => subscribeSheet.props?.onDismiss());
    expect(subscribeSheet.props?.open).toBe(false);
  });
});

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

  // The day is the heading over the rows now (#3707), so the card says only
  // its time; the board's "THU / 14" date block went with the headings.
  it("puts the card under its written-out day heading, with no date block", () => {
    const tree = render();
    const text = screenText(tree);
    // Mounted eleven minutes before the start: the same local day in most
    // zones, the day before in a few, so either heading is right.
    expect(text).toMatch(/^(Today|Tomorrow)$/m);
    expect(text.indexOf("Chapter meeting")).toBeGreaterThan(
      text.search(/^(Today|Tomorrow)$/m),
    );
    expect(text).not.toMatch(/^Tmrw$/m);
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
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.card);
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

  it("paints Mandatory as quiet hairline metadata and points in the accent", () => {
    events = [{ ...EVENT, is_mandatory: true, point_value: 10 }];
    const tree = render();

    // The hairline kind, as web's row (#3822, #4132): muted text, no fill.
    expect(styleOf(tree, "Mandatory").color).toBe(
      signetDarkTokens.color.text.mutedForeground,
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

    expect(screenText(tree)).toContain("Choose a chapter from You");
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
 * rest sit flush on the floor, with points in the meta line as web writes
 * them. Since #3707 they sit under day headings, two weeks of them, with the
 * rest behind Later.
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

  it("heads each day, and keeps everything past two weeks behind Later", () => {
    events = [
      make("a", 0),
      make("b", 2),
      make("c", 10, { point_value: 15, location: "Library" }),
      make("d", 20),
    ];
    const tree = render();
    let text = screenText(tree);
    const weekday = at(2).toLocaleDateString(undefined, { weekday: "long" });
    expect(text).toMatch(new RegExp(`^${weekday}$`, "m"));
    expect(text.indexOf("Event b")).toBeGreaterThan(text.indexOf(weekday));
    // A count read as text is written out, as web writes it (#4135).
    expect(text).toMatch(/Library · 15 points/);
    expect(text).not.toContain("+15 pts");
    // Day 20 is past the horizon: one Later row offers it, folded, with
    // web's count beside it (#4135).
    expect(text).toContain("Later");
    expect(text).toContain("1 event");
    expect(text).not.toContain("Event d");

    const later = tree.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.accessibilityLabel === "Later, 1 event",
    );
    expect(later.props.accessibilityState).toEqual({ expanded: false });
    act(() => later.props.onPress());
    text = screenText(tree);
    expect(text).toContain("Event d");
    // Open now, to a screen reader and to the eye: the chevron turns down.
    expect(later.props.accessibilityState).toEqual({ expanded: true });
    expect(
      later.findAll((node) => (node.type as unknown) === DisclosureGlyph)[0]
        ?.props.direction,
    ).toBe("down");
  });

  it("says when nothing falls in the next two weeks", () => {
    events = [make("far", 30)];
    const text = screenText(render());
    expect(text).toContain("Nothing in the next two weeks.");
    expect(text).toContain("1 event");
  });

  it('draws a weekly series once, as "Chapter · Every …" (#3823)', () => {
    const weekday = START.toLocaleDateString(undefined, { weekday: "long" });
    events = Array.from({ length: 13 }, (_, index) =>
      make(index === 0 ? "head" : `child-${index}`, index * 7, {
        name: "Chapter",
        recurrence_rule: index === 0 ? "WEEKLY" : null,
        parent_event_id: index === 0 ? null : "head",
      }),
    );
    const tree = render();
    const rows = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Open Chapter"),
    );
    expect(rows).toHaveLength(1);
    expect(drawnText(rows[0]!)).toContain(`Chapter · Every ${weekday}`);
    // Nothing waits in Later: the other twelve live on the event's page.
    expect(screenText(tree)).not.toContain("Later");
  });

  it("draws a later row with no card fill and Mandatory as a hairline", () => {
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
      signetDarkTokens.color.text.mutedForeground,
    );
  });

  it("splits a day's rows by hairlines, none above the first, and bleeds into the gutter", () => {
    events = [
      make("a", 0),
      make("b", 2),
      make("c", 2, {
        start_time: new Date(at(2).getTime() + 3_600_000).toISOString(),
      }),
    ];
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

/** #3792 / #3823: a List | Calendar switch that opens on the last one used. */
describe("Events view switch", () => {
  const viewSwitch = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );

  it("switches to a month calendar, marks event days, and remembers the pick", () => {
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());

    const month = START.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    expect(screenText(tree)).toContain(month);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          String(node.props.testID).startsWith("event-dot-"),
      ),
    ).toHaveLength(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      EVENTS_VIEW_STORAGE_KEY,
      "calendar",
    );
  });

  it("opens on Calendar after a restart when Calendar was the last pick", async () => {
    // A fresh process: the screen's own subscription reads storage.
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce("calendar");
    const tree = render();
    // Let the stored read land; nothing here calls hydrate by hand.
    await act(async () => {
      await Promise.resolve();
    });
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(EVENTS_VIEW_STORAGE_KEY);
    expect(viewSwitch(tree, "Calendar").props.accessibilityState.checked).toBe(
      true,
    );
    expect(screenText(tree)).toContain(
      START.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    );
  });

  it("says nothing is scheduled in Calendar too, for a chapter with no events", () => {
    permissions = ["*"];
    events = [];
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    expect(screenText(tree)).not.toContain("Nothing on this day.");
    permissions = [];
  });

  it("says nothing is scheduled in Calendar for a chapter with only past events", () => {
    permissions = ["*"];
    events = [
      {
        ...EVENT,
        id: "past",
        start_time: new Date(START.getTime() - 30 * 86_400_000).toISOString(),
        end_time: new Date(
          START.getTime() - 30 * 86_400_000 + 3_600_000,
        ).toISOString(),
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("Nothing scheduled yet.");
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    permissions = [];
  });

  it("keeps a picked day and its month together as the clock moves on", () => {
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    const month = START.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const day = tree.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        String(node.props.accessibilityLabel).endsWith(", 1 event"),
    );
    act(() => day.props.onPress());
    // Six weeks on, the tab still mounted.
    act(() => {
      vi.advanceTimersByTime(42 * 86_400_000);
    });
    expect(screenText(tree)).toContain(month);
    expect(screenText(tree)).toContain("Chapter meeting");
  });

  it("follows the clock to a new day until the member picks one", () => {
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    const heading = () =>
      tree.root
        .findAllByType("Text" as never)
        .map((node) => node.props.children)
        .filter((text) => text === "Today" || text === "Yesterday");
    expect(heading()).toContain("Today");
    // A day and a half later, the tab still mounted.
    act(() => {
      vi.advanceTimersByTime(36 * 3_600_000);
    });
    expect(heading()).toContain("Today");
    expect(heading()).not.toContain("Yesterday");
  });

  it("turns the month with the chevrons and lists the chosen day's events", () => {
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    const next = START.getMonth() + 1;
    const nextLabel = new Date(START.getFullYear(), next, 1).toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" },
    );
    const chevron = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Next month" &&
        typeof node.props.onPress === "function",
    );
    act(() => chevron.props.onPress());
    expect(screenText(tree)).toContain(nextLabel);

    // Back, then pick the event's day: its row lists under the grid.
    const prev = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Previous month" &&
        typeof node.props.onPress === "function",
    );
    act(() => prev.props.onPress());
    const day = tree.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        String(node.props.accessibilityLabel).endsWith(", 1 event"),
    );
    act(() => day.props.onPress());
    expect(screenText(tree)).toContain("Chapter meeting");
  });
});

/** #4144: the member's tasks and the ones they assigned, on the Calendar. */
describe("Tasks on the Calendar", () => {
  const viewSwitch = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );
  const pressable = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );

  function withTasks() {
    const due = localIsoDate(MOUNTED_AT);
    tasks = [
      {
        id: "t-mine",
        title: "Clean the kitchen",
        assignee_id: "me",
        created_by: "m1",
        due_date: due,
        status: "OVERDUE",
      },
      {
        id: "t-1",
        title: "Dues form",
        assignee_id: "m1",
        created_by: "me",
        due_date: due,
        status: "COMPLETED",
      },
      {
        id: "t-2",
        title: "Dues form",
        assignee_id: "m2",
        created_by: "me",
        due_date: due,
        status: "TODO",
      },
    ];
  }

  it("lists the day's tasks under its events, with where they stand", () => {
    withTasks();
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());

    const text = screenText(tree);
    expect(text).toContain("Clean the kitchen");
    expect(text).toContain("Overdue");
    expect(text).toContain("Assigned by you · 1 of 2 done");
    // A ring marks the day, beside the event dot.
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          String(node.props.testID).startsWith("task-ring-"),
      ),
    ).toHaveLength(1);
  });

  it("opens an assigned task in place to show each assignee", () => {
    withTasks();
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    expect(screenText(tree)).not.toContain("Ana Ruiz");

    act(() =>
      pressable(
        tree,
        "Dues form, assigned by you, 1 of 2 done",
      ).props.onPress(),
    );
    const text = screenText(tree);
    expect(text).toContain("Ana Ruiz");
    expect(text).toContain("Waiting on an officer");
  });

  it("turns a kind off from its chip and remembers it", () => {
    withTasks();
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());

    act(() => pressable(tree, "My tasks").props.onPress());
    expect(screenText(tree)).not.toContain("Clean the kitchen");
    expect(screenText(tree)).toContain("Dues form");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "frapp.events.calendar-layers",
      JSON.stringify(["events", "assigned"]),
    );
  });

  it("offers no chips to a member with no tasks", () => {
    const tree = render();
    act(() => viewSwitch(tree, "Calendar").props.onPress());
    expect(screenText(tree)).not.toContain("My tasks");
  });
});
