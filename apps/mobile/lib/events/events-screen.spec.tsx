/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  Alert,
  StyleSheet,
  type AlertButton,
  type TextStyle,
} from "react-native";
import { SERIES_SCOPE_COPY } from "@repo/validation";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { HeaderButton } from "@/components/header-button";
import { DisclosureGlyph, ForwardGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_SIZE, LeadTile } from "@/components/lead-tile";
import { NavGlyph } from "@/components/nav-glyph";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import * as expoRouter from "expo-router";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_ACTIVITY, BACK_TO_EVENTS } from "@/components/back-row";
import type { NewEventDraft } from "@/lib/events/create-event";
import { selectCalendarTasks } from "@repo/hooks/calendar-tasks";
import {
  selectCalendarBirthdays,
  type MemberBirthday,
} from "@repo/hooks/calendar-birthdays";
import { localIsoDate } from "@repo/formatting";
import { InlineNote } from "@/components/inline-note";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * s06, rendered: the Calendar's month (`app/(app)/events.tsx`) and the Day
 * screen it pushes (`app/(app)/calendar-day.tsx`, #5310). They live here: a
 * spec under `app/` ships as a route module (`lib/routes.spec.ts`).
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
// Birthdays members share (#4959), as `GET /v1/members/birthdays` lists them.
let birthdays: MemberBirthday[] = [];
const birthdaysRefetch = vi.fn(() => Promise.resolve());
// The long-press menus' writes (#5492).
const deleteEvent = vi.fn();
const deleteTask = vi.fn<(target: unknown) => Promise<object>>(
  async () => ({}),
);
const updateStatus = vi.fn<(input: unknown) => Promise<object>>(
  async () => ({}),
);

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
  useCalendarBirthdays: (anchor: Date) =>
    selectCalendarBirthdays(birthdays, [anchor.getFullYear()]),
  useMemberBirthdays: () => ({
    ...query,
    data: birthdays,
    refetch: birthdaysRefetch,
  }),
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
  // An event row's Edit reads the event (`EventEditHost`).
  useEvent: (id: string) => ({
    ...query,
    isPending: false,
    data: (events as { id: string }[]).find((event) => event.id === id),
  }),
  useDeleteEvent: () => ({ mutate: deleteEvent, isPending: false }),
  useDeleteTask: () => ({ mutateAsync: deleteTask, isPending: false }),
  useUpdateTaskStatus: () => ({ mutateAsync: updateStatus }),
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
// New event has its own spec; here only what an hour press hands it, and
// that the screen presents it.
const newEventSheet = vi.hoisted(() => ({
  props: null as null | { template?: NewEventDraft; editing?: unknown },
  presented: 0,
}));
vi.mock("@/components/events/new-event-sheet", async (importOriginal) => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    ...(await importOriginal<
      typeof import("@/components/events/new-event-sheet")
    >()),
    NewEventSheet: forwardRef(function NewEventSheet(
      props: { template?: NewEventDraft; editing?: unknown },
      ref,
    ) {
      newEventSheet.props = props;
      useImperativeHandle(ref, () => ({
        present: () => {
          newEventSheet.presented += 1;
        },
      }));
      return null;
    }),
  };
});
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

// The Day screen's `day` param; `undefined` is none.
let dayParam: string | undefined;
vi.mocked(expoRouter.useLocalSearchParams).mockImplementation(
  (): Record<string, string> =>
    dayParam === undefined ? {} : { day: dayParam },
);

import EventsScreen from "@/app/(app)/events";
import CalendarDayScreen from "@/app/(app)/calendar-day";

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

function renderDay(day?: Date): ReactTestRenderer {
  dayParam = day ? localIsoDate(day) : undefined;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <CalendarDayScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const longDay = (day: Date) =>
  day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

/** Picks `day` on the month, by its square. */
function pickDay(tree: ReactTestRenderer, day: Date) {
  const cell = tree.root.find(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.props.accessibilityState?.selected !== undefined &&
      String(node.props.accessibilityLabel).startsWith(longDay(day)),
  );
  act(() => cell.props.onPress());
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
  dayParam = undefined;
  vi.mocked(vi.mocked(expoRouter.useRouter)().push).mockClear();
  newEventSheet.props = null;
  newEventSheet.presented = 0;
  tasks = [];
  birthdays = [];
  birthdaysRefetch.mockClear();
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

// #5113 (Shawn, 2026-11-15): add an event from the Calendar itself, in every
// view, not only from the tab bar's + (which a member can take off their
// panel) or an hour of the grid.
describe("Events header New event", () => {
  const nextMonth = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Next month" &&
        typeof node.props.onPress === "function",
    );

  it("draws a round + after Subscribe for a member who can create", () => {
    permissions = ["*"];
    const labels = render()
      .root.findAllByType(HeaderButton)
      .map((node) => node.props.label);
    expect(labels).toEqual([
      "Subscribe to events in your calendar",
      "New event",
    ]);
    permissions = [];
  });

  it("draws no + for a member who can't create", () => {
    permissions = ["events:create"];
    expect(createButton(render())).toBeUndefined();
    permissions = [];
  });

  it("starts the event on the day picked on the month", () => {
    permissions = ["*"];
    const tree = render();
    // Today picked: today, never the sheet's roll to tomorrow
    // (`pickedDayStart` has its own spec for the hours).
    act(() => createButton(tree)!.props.onPress());
    const start = newEventSheet.props?.template?.start;
    expect(start?.toDateString()).toBe(new Date().toDateString());
    // The next month follows to its 1st, a day still ahead.
    act(() => nextMonth(tree).props.onPress());
    act(() => createButton(tree)!.props.onPress());
    const now = new Date();
    expect(newEventSheet.props?.template?.start).toEqual(
      new Date(now.getFullYear(), now.getMonth() + 1, 1, 19),
    );
    expect(newEventSheet.presented).toBe(2);
    permissions = [];
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

/**
 * From the owner's 2026-11-04 Android test feedback: s06 carried its own
 * spinner-in-a-card state blocks, and with no active chapter `useEvents`
 * never runs, so the spinner never stopped.
 */
describe("Calendar states", () => {
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

    // One region, named for what loads, shaped as the month.
    expect(skeletons(tree)).toHaveLength(1);
    expect(skeletons(tree)[0]!.props.accessibilityLabel).toBe(
      "Loading the calendar",
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
    // The calendar's birthdays too (#4959).
    expect(birthdaysRefetch).toHaveBeenCalledWith({ cancelRefetch: true });
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

  it("points a creator at the header's + when nothing is scheduled", () => {
    // An owner's grant is the wildcard.
    permissions = ["*"];
    events = [];
    const tree = render();

    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    // The + the line names is the screen's own, in the header (#5113).
    expect(createButton(tree)).toBeDefined();
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
 * The picked day's rows, flush on the floor (owner pick 2026-11-05), each as
 * Activity draws an event (#4679), with points in the meta line as web
 * writes them.
 */
describe("Calendar day rows", () => {
  const at = (days: number) => new Date(START.getTime() + days * 86_400_000);
  const make = (id: string, days: number, extra: object = {}) => ({
    ...EVENT,
    id,
    name: `Event ${id}`,
    start_time: at(days).toISOString(),
    end_time: new Date(at(days).getTime() + 3_600_000).toISOString(),
    ...extra,
  });

  // A weekly "Chapter" series meeting today and every 7 days after.
  const weeklySeries = (length: number) =>
    Array.from({ length }, (_, index) =>
      make(index === 0 ? "head" : `child-${index}`, index * 7, {
        name: "Chapter",
        recurrence_rule: index === 0 ? "WEEKLY" : null,
        parent_event_id: index === 0 ? null : "head",
      }),
    );

  it('says a series meeting\'s cadence on its day, "Chapter · Every …" (#3823)', () => {
    const weekday = START.toLocaleDateString(undefined, { weekday: "long" });
    events = weeklySeries(4);
    const tree = render();
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Open Chapter"),
    );
    expect(row.props.accessibilityLabel).toBe(`Open Chapter, Every ${weekday}`);
    expect(drawnText(row)).toContain(`Chapter · Every ${weekday}`);
  });

  it("draws a later row with no card fill and Mandatory as a hairline", () => {
    events = [make("a", 0), make("b", 2, { is_mandatory: true })];
    const tree = render();
    pickDay(tree, at(2));
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

  it("draws a later row as Activity draws an event: a tile, the name in the label role, a chevron (#4679)", () => {
    events = [
      make("a", 0),
      make("b", 2, {
        is_mandatory: true,
        point_value: 15,
        location: "Library",
      }),
    ];
    const tree = render();
    pickDay(tree, at(2));
    const rowOf = (name: string) =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === `Open ${name}`,
      );
    const row = rowOf("Event b");
    const tiles = row.findAllByType(LeadTile);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.props.size).toBe("lead");
    // The chevron is the row's last thing, after Mandatory.
    const trailing = row.findAll(
      (node) =>
        node.type === ForwardGlyph ||
        ((node.type as unknown) === "Text" &&
          node.props.children === "Mandatory"),
    );
    expect(trailing.map((node) => node.type === ForwardGlyph)).toEqual([
      false,
      true,
    ]);
    expect(
      (
        StyleSheet.flatten(
          row.findAll(
            (node) =>
              (node.type as unknown) === "Text" &&
              node.props.children === "Event b",
          )[0]!.props.style,
        ) as TextStyle
      ).fontSize,
    ).toBe(signetDarkTokens.typography.role.label.size);
    // The tile holds the Events glyph, the one Activity leads an event with.
    expect(tiles[0]!.findByType(NavGlyph).props.paths).toBe(NAV_GLYPHS.events);
    // The tile row's frame: the tile sets the height, so the small padding
    // step, which is what the loading rows stand on.
    expect(
      StyleSheet.flatten(row.props.style({ pressed: false })).paddingVertical,
    ).toBe(signetDarkTokens.spacing.sm);
    // A count read as text is written out, as web writes it (#4135).
    expect(screenText(tree)).toMatch(/Library · 15 points/);
    expect(screenText(tree)).not.toContain("+15 pts");
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
    pickDay(tree, at(2));
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

/**
 * #3792, and #5310 (Paul, 2026-11-17: "I hate the calendar page"): the month
 * is the whole screen. No List | Calendar switch, no Month | 3 days | Day,
 * no chips: the month row, the grid and the picked day's list.
 */
describe("Calendar month", () => {
  it("is a pushed screen, its way back Activity", () => {
    const shell = render().root.findByType(ScreenShell);
    expect(shell.props.title).toBe("Calendar");
    expect(shell.props.back).toEqual(BACK_TO_ACTIVITY);
  });

  it("draws no switcher and no chips above the month", () => {
    tasks = [
      {
        id: "t-mine",
        title: "Clean the kitchen",
        assignee_id: "me",
        created_by: "m1",
        due_date: localIsoDate(MOUNTED_AT),
        status: "TODO",
      },
    ];
    const tree = render();
    for (const role of ["radio", "radiogroup", "switch", "toolbar"]) {
      expect(
        tree.root.findAll((node) => node.props.accessibilityRole === role),
      ).toHaveLength(0);
    }
    for (const label of ["List", "3 days", "Day", "My tasks", "Events"]) {
      expect(screenText(tree)).not.toMatch(new RegExp(`^${label}$`, "m"));
    }
  });

  it("marks event days on a month calendar", () => {
    const tree = render();

    const month = START.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    expect(screenText(tree)).toContain(month);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          String(node.props.testID).startsWith("event-title-"),
      ),
    ).toHaveLength(1);
  });

  it("writes a day's events by title in its square, a required one in the accent", () => {
    events = [
      EVENT,
      {
        ...EVENT,
        id: "evt-2",
        name: "Initiation",
        start_time: new Date(START.getTime() + 2 * 3_600_000).toISOString(),
        end_time: new Date(START.getTime() + 3 * 3_600_000).toISOString(),
        is_mandatory: true,
      },
    ];
    const tree = render();
    const titles = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        String(node.props.testID).startsWith("event-title-"),
    );
    expect(titles.map((node) => node.props.children)).toEqual([
      "Chapter meeting",
      "Initiation",
    ]);
    expect(StyleSheet.flatten(titles[0]!.props.style).color).not.toBe(ACCENT);
    expect(StyleSheet.flatten(titles[1]!.props.style).color).toBe(ACCENT);
    // The day's spoken label names both.
    expect(
      tree.root.findAll((node) =>
        String(node.props.accessibilityLabel).includes(
          ", 2 events, Chapter meeting, Initiation",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("leaves off the weeks at the end with no day of the month", () => {
    const tree = render();
    const month = new Date(START.getFullYear(), START.getMonth(), 1);
    const last = new Date(START.getFullYear(), START.getMonth() + 1, 0);
    const weeks = Math.ceil((month.getDay() + last.getDate()) / 7);
    const dayButtons = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function" &&
        node.props.accessibilityState?.selected !== undefined,
    );
    expect(weeks).toBeLessThan(6);
    expect(dayButtons).toHaveLength(weeks * 7);
  });

  it("says nothing is scheduled under the month, for a chapter with no events", () => {
    permissions = ["*"];
    events = [];
    const tree = render();
    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    expect(screenText(tree)).not.toContain("Nothing on this day.");
    permissions = [];
  });

  it("says nothing is scheduled for a chapter with only past events", () => {
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
    expect(screenText(tree)).toContain(
      "Nothing scheduled yet. Tap + to add the first event.",
    );
    permissions = [];
  });

  it("keeps a picked day and its month together as the clock moves on", () => {
    const tree = render();
    const month = START.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const day = tree.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        String(node.props.accessibilityLabel).includes(", 1 event, "),
    );
    act(() => day.props.onPress());
    // Six weeks on, the screen still mounted.
    act(() => {
      vi.advanceTimersByTime(42 * 86_400_000);
    });
    expect(screenText(tree)).toContain(month);
    expect(screenText(tree)).toContain("Chapter meeting");
  });

  it("follows the clock to a new day until the member picks one", () => {
    const tree = render();
    const heading = () =>
      tree.root
        .findAllByType("Text" as never)
        .map((node) => node.props.children)
        .filter((text) => text === "Today" || text === "Yesterday");
    expect(heading()).toContain("Today");
    // A day and a half later, the screen still mounted.
    act(() => {
      vi.advanceTimersByTime(36 * 3_600_000);
    });
    expect(heading()).toContain("Today");
    expect(heading()).not.toContain("Yesterday");
  });

  it("turns the month with the chevrons and lists the chosen day's events", () => {
    const tree = render();
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
        String(node.props.accessibilityLabel).includes(", 1 event, "),
    );
    act(() => day.props.onPress());
    expect(screenText(tree)).toContain("Chapter meeting");
  });
});

/** #5310: the hour grid lives on the Day screen, opened from the heading. */
// #5492 (Paul, 2026-11-18): hold an event or a task on the Calendar for its
// actions, gated as `event.controller.ts` and `task.controller.ts` gate them.
describe("Calendar long-press menus", () => {
  const eventRow = (tree: ReactTestRenderer, name = "Chapter meeting") =>
    tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(`Open ${name}`),
    );
  const openMenu = (row: ReactTestInstance) => {
    expect(row.props.onLongPress, "a long press").toBeTypeOf("function");
    act(() => row.props.onLongPress({ nativeEvent: { pageY: 320 } }));
  };
  const items = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "menuitem",
    );
  const labels = (tree: ReactTestRenderer) =>
    items(tree).map((node) => node.props.accessibilityLabel as string);
  const pick = (tree: ReactTestRenderer, label: string) =>
    act(() =>
      items(tree)
        .find((node) => node.props.accessibilityLabel === label)!
        .props.onPress(),
    );

  beforeEach(() => {
    deleteEvent.mockClear();
    vi.mocked(Alert.alert).mockClear();
  });

  it("gives a member who can't change events no long press", () => {
    permissions = [];
    expect(eventRow(render()).props.onLongPress).toBeUndefined();
  });

  it("offers each action only with its grant", () => {
    permissions = ["members:view", "events:update"];
    let tree = render();
    openMenu(eventRow(tree));
    expect(labels(tree)).toEqual(["Edit"]);

    permissions = ["members:view", "events:create"];
    tree = render();
    openMenu(eventRow(tree));
    expect(labels(tree)).toEqual(["Duplicate"]);

    permissions = ["members:view", "events:delete"];
    tree = render();
    openMenu(eventRow(tree));
    expect(labels(tree)).toEqual(["Delete"]);

    permissions = ["*"];
    tree = render();
    openMenu(eventRow(tree));
    expect(labels(tree)).toEqual(["Edit", "Duplicate", "Delete"]);
  });

  it("Edit opens Edit event on the event, over the Calendar", () => {
    permissions = ["*"];
    const tree = render();
    openMenu(eventRow(tree));
    const presented = newEventSheet.presented;
    pick(tree, "Edit");
    expect(newEventSheet.props?.editing).toMatchObject({
      event: { id: "evt-1", name: "Chapter meeting" },
    });
    expect(newEventSheet.presented).toBe(presented + 1);
    expect(vi.mocked(expoRouter.useRouter)().push).not.toHaveBeenCalled();
  });

  it("Duplicate opens New event filled in from it, as a new event ahead", () => {
    permissions = ["*"];
    events = [{ ...EVENT, location: "Great Room", point_value: 10 }];
    const tree = render();
    openMenu(eventRow(tree));
    pick(tree, "Duplicate");
    const template = newEventSheet.props?.template;
    expect(newEventSheet.props?.editing).toBeUndefined();
    expect(template).toMatchObject({
      name: "Chapter meeting",
      location: "Great Room",
      pointsInput: "10",
    });
    expect(template?.start?.toISOString()).toBe(START.toISOString());
  });

  it("Delete asks, then deletes the one event", async () => {
    permissions = ["*"];
    const tree = render();
    openMenu(eventRow(tree));
    pick(tree, "Delete");
    expect(deleteEvent).not.toHaveBeenCalled();
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe("Delete this event?");
    await act(async () => {
      (buttons as AlertButton[])
        .find((button) => button.text === "Delete")!
        .onPress?.();
    });
    expect(deleteEvent).toHaveBeenCalledWith(
      { id: "evt-1", scope: "instance" },
      expect.any(Object),
    );
  });

  it("asks a repeating event's Delete this one or all upcoming", () => {
    permissions = ["*"];
    events = [{ ...EVENT, recurrence_rule: "WEEKLY", parent_event_id: null }];
    const tree = render();
    openMenu(eventRow(tree));
    pick(tree, "Delete");
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect((buttons as AlertButton[]).map((button) => button.text)).toEqual([
      SERIES_SCOPE_COPY.thisEvent,
      SERIES_SCOPE_COPY.allUpcoming,
      "Cancel",
    ]);
  });

  it("offers a member their own task's Mark done, and an officer's two separate tasks none", () => {
    const due = localIsoDate(MOUNTED_AT);
    permissions = ["members:view", "tasks:manage"];
    tasks = [
      {
        id: "t-mine",
        title: "Clean the kitchen",
        assignee_id: "me",
        created_by: "m1",
        due_date: due,
        status: "TODO",
        stored_status: "TODO",
      },
      ...["m1", "m2"].map((assignee) => ({
        id: `t-${assignee}`,
        title: "Dues form",
        assignee_id: assignee,
        created_by: "me",
        due_date: due,
        status: "TODO",
        stored_status: "TODO",
      })),
    ];
    const tree = render();
    const mine = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Clean the kitchen"),
    );
    openMenu(mine);
    expect(labels(tree)).toEqual([
      "Mark done",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
    const assigned = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Dues form"),
    );
    expect(assigned.props.onLongPress).toBeUndefined();
  });

  it("puts the menu on the Day screen's event blocks too", () => {
    permissions = ["*"];
    const tree = renderDay(START);
    const block = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.testID).startsWith("time-grid-block-evt-1"),
    );
    openMenu(block);
    expect(labels(tree)).toEqual(["Edit", "Duplicate", "Delete"]);
  });
});

describe("Calendar day heading", () => {
  it("opens the picked day's hour grid", () => {
    const tree = render();
    const later = new Date(
      MOUNTED_AT.getFullYear(),
      MOUNTED_AT.getMonth(),
      MOUNTED_AT.getDate() + 2,
    );
    pickDay(tree, later);
    const heading = tree.root.find(
      (node) =>
        node.props.testID === "calendar-day-heading" &&
        typeof node.props.onPress === "function",
    );
    expect(heading.props.accessibilityLabel).toMatch(/, open the day$/);
    expect(heading.findAllByType(DisclosureGlyph)).toHaveLength(1);
    act(() => heading.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/calendar-day",
      params: { day: localIsoDate(later) },
    });
  });
});

/** #4144: the member's tasks and the ones they assigned, on the Calendar. */
describe("Tasks on the Calendar", () => {
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

    const text = screenText(tree);
    expect(text).toContain("Clean the kitchen");
    expect(text).toContain("Overdue");
    expect(text).toContain("Assigned by you · 1 of 2 done");
    // Each task leads with the event rows' tile, so the day's rows share one
    // text column, and the member's own ends in the chevron of a row that
    // opens (#4679).
    const taskTiles = tree.root
      .findAllByType(LeadTile)
      .filter((tile) => tile.props.testID === "calendar-task-lead");
    expect(taskTiles).toHaveLength(2);
    expect(
      pressable(tree, "Clean the kitchen, your task, overdue").findAllByType(
        ForwardGlyph,
      ),
    ).toHaveLength(1);
    // One that opens in place draws the chevron that turns instead, right
    // while its assignees are hidden.
    const assigned = pressable(tree, "Dues form, assigned by you, 1 of 2 done");
    expect(assigned.findAllByType(ForwardGlyph)).toHaveLength(0);
    expect(assigned.findByType(DisclosureGlyph).props.direction).toBe("right");
    // Both stand on the event rows' frame, their names in the label role.
    for (const label of [
      "Dues form, assigned by you, 1 of 2 done",
      "Clean the kitchen, your task, overdue",
    ]) {
      const host = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === label,
      );
      expect(
        StyleSheet.flatten(host.props.style({ pressed: false }))
          .paddingVertical,
      ).toBe(signetDarkTokens.spacing.sm);
    }
    expect(styleOf(tree, "Dues form").fontSize).toBe(
      signetDarkTokens.typography.role.label.size,
    );
    // The day's square says it's overdue under the event's title, in the
    // destructive text hue, rather than counting the tasks.
    const footers = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        String(node.props.testID).startsWith("cell-footer-"),
    );
    expect(footers).toHaveLength(1);
    expect(footers[0]!.props.children).toBe("Overdue");
    expect(StyleSheet.flatten(footers[0]!.props.style).color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
    );
  });

  it("opens an assigned task in place to show each assignee", () => {
    withTasks();
    const tree = render();
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
    // The chevron turns down, and the names sit under the row's text
    // column: past the 40pt tile and the row's gap (#4679).
    expect(
      pressable(tree, "Dues form, assigned by you, 1 of 2 done").findByType(
        DisclosureGlyph,
      ).props.direction,
    ).toBe("down");
    let list = tree.root
      .findAllByType("Text" as never)
      .find((node) => node.props.children === "Ana Ruiz")!.parent!;
    while (
      (list.type as unknown) !== "View" ||
      StyleSheet.flatten(list.props.style).paddingLeft === undefined
    ) {
      list = list.parent!;
    }
    expect(StyleSheet.flatten(list.props.style).paddingLeft).toBe(
      LEAD_TILE_SIZE.lead + signetDarkTokens.spacing.md,
    );
  });

  describe("birthdays (#4959)", () => {
    function withBirthday() {
      birthdays = [
        {
          id: "m2",
          display_name: "Dana Lowe",
          avatar_url: null,
          birthday_month: MOUNTED_AT.getMonth() + 1,
          birthday_day: MOUNTED_AT.getDate(),
        },
      ];
    }

    it("lists a shared birthday on its day and marks the day", () => {
      withBirthday();
      const tree = render();

      expect(screenText(tree)).toContain("Dana Lowe");
      expect(screenText(tree)).toContain("Birthday");
      const key = localIsoDate(MOUNTED_AT);
      expect(
        tree.root.findAll(
          (node) => node.props.testID === `birthday-mark-${key}`,
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  // #5310: no layer chips, so every kind shows, always.
  it("shows the member's tasks, the ones they assigned and birthdays together", () => {
    withTasks();
    birthdays = [
      {
        id: "m2",
        display_name: "Dana Lowe",
        avatar_url: null,
        birthday_month: MOUNTED_AT.getMonth() + 1,
        birthday_day: MOUNTED_AT.getDate(),
      },
    ];
    const text = screenText(render());
    expect(text).toContain("Clean the kitchen");
    expect(text).toContain("Assigned by you · 1 of 2 done");
    expect(text).toContain("Dana Lowe");
  });
});

/**
 * #4818's Day, the hour grid, as its own screen pushed from the month's day
 * heading since #5310 (the 3 days range went then).
 */
describe("Calendar day screen", () => {
  const pressable = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );
  const dayColumns = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          String(node.props.testID).startsWith("time-grid-day-"),
      )
      .map((node) => String(node.props.testID).slice("time-grid-day-".length));
  const nowLines = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        node.props.testID === "time-grid-now",
    );
  const today = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const plusDays = (day: Date, n: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);

  it("is titled for its day, its way back the Calendar", () => {
    const day = plusDays(today(), 1);
    const shell = renderDay(day).root.findByType(ScreenShell);
    expect(shell.props.title).toBe(longDay(day));
    expect(shell.props.back).toEqual(BACK_TO_EVENTS);
  });

  it("draws today for a missing or malformed day", () => {
    expect(dayColumns(renderDay())).toEqual([localIsoDate(today())]);
    dayParam = "2026-02-30";
    act(() => {
      mounted.push(
        create(
          <FrappThemeProvider>
            <CalendarDayScreen />
          </FrappThemeProvider>,
        ),
      );
    });
    expect(dayColumns(mounted[mounted.length - 1]!)).toEqual([
      localIsoDate(today()),
    ]);
  });

  it("draws the event as a block on its day, which opens it", () => {
    const start = new Date(EVENT.start_time);
    const tree = renderDay(start);
    const key = localIsoDate(start);
    const block = tree.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.testID === `time-grid-block-${EVENT.id}-${key}`,
    );
    expect(block.props.accessibilityLabel).toMatch(/^Open Chapter meeting, /);
    act(() => block.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: EVENT.id },
    });
  });

  it("marks now on today, and with no day picked follows the clock to the next", () => {
    const tree = renderDay();
    const [line] = nowLines(tree);
    expect(nowLines(tree)).toHaveLength(1);
    // The line sits inside today's column.
    let parent = line!.parent;
    while (parent && !String(parent.props.testID).startsWith("time-grid-day-"))
      parent = parent.parent;
    expect(parent?.props.testID).toBe(`time-grid-day-${localIsoDate(today())}`);

    // A day and a half on, still mounted: the grid follows the clock to the
    // new today, and the line is drawn there.
    act(() => {
      vi.advanceTimersByTime(36 * 3_600_000);
    });
    expect(dayColumns(tree)[0]).toBe(localIsoDate(today()));
    expect(nowLines(tree)).toHaveLength(1);
    // Another day has no now line.
    expect(nowLines(renderDay(plusDays(today(), 1)))).toHaveLength(0);
  });

  it("puts an event of a day or more in the All day strip on a day it covers", () => {
    const first = today();
    events = [
      {
        ...EVENT,
        id: "retreat",
        name: "Retreat",
        start_time: new Date(
          first.getFullYear(),
          first.getMonth(),
          first.getDate(),
          9,
        ).toISOString(),
        end_time: new Date(
          first.getFullYear(),
          first.getMonth(),
          first.getDate() + 2,
          12,
        ).toISOString(),
      },
    ];
    const tree = renderDay(plusDays(first, 1));
    expect(screenText(tree)).toContain("All day");
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel === "Open Retreat, all day" &&
          typeof node.props.onPress === "function",
      ),
    ).toHaveLength(1);
  });

  const hourText = (hour: number) =>
    new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, {
      hour: "numeric",
    });

  it("opens New event at a pressed hour for a member who can create", () => {
    permissions = ["*"];
    const day = plusDays(today(), 1);
    const tree = renderDay(day);
    expect(newEventSheet.props).toBeNull();
    act(() =>
      pressable(
        tree,
        `Create event on ${longDay(day)} at ${hourText(20)}`,
      ).props.onPress(),
    );
    expect(newEventSheet.props?.template?.start).toEqual(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), 20),
    );
    expect(newEventSheet.presented).toBe(1);
    permissions = [];
  });

  it("offers no hour that is already over", () => {
    permissions = ["*"];
    const tree = renderDay(today());
    const now = new Date();
    const hasSlot = (hour: number) =>
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel ===
            `Create event on ${longDay(today())} at ${hourText(hour)}` &&
          typeof node.props.onPress === "function",
      ).length > 0;
    for (let hour = 0; hour < now.getHours(); hour += 1) {
      expect(hasSlot(hour)).toBe(false);
    }
    expect(hasSlot(now.getHours())).toBe(true);
    // Yesterday has none at all.
    const yesterday = renderDay(plusDays(today(), -1));
    expect(
      yesterday.root.findAll((node) =>
        String(node.props.accessibilityLabel).startsWith("Create event on"),
      ),
    ).toHaveLength(0);
    permissions = [];
  });

  it("offers no hour to press for a member who can't create", () => {
    permissions = [];
    const tree = renderDay(today());
    expect(
      tree.root.findAll((node) =>
        String(node.props.accessibilityLabel).startsWith("Create event on"),
      ),
    ).toHaveLength(0);
  });

  const styleOfNode = (node: ReactTestInstance) =>
    StyleSheet.flatten(
      typeof node.props.style === "function"
        ? node.props.style({ pressed: false })
        : node.props.style,
    ) as Record<string, unknown>;
  const blocks = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        String(node.props.testID).startsWith("time-grid-block-"),
    );

  it("sizes a block by its length and sets overlapping ones side by side", () => {
    const day = plusDays(today(), 1);
    const at = (hour: number, minute = 0) =>
      new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
      ).toISOString();
    events = [
      {
        ...EVENT,
        id: "long",
        name: "Long",
        start_time: at(18),
        end_time: at(21),
      },
      {
        ...EVENT,
        id: "overlap",
        name: "Overlap",
        start_time: at(19, 30),
        end_time: at(20, 30),
      },
    ];
    const tree = renderDay(day);
    const [long, overlap] = ["long", "overlap"].map((id) =>
      blocks(tree).find((node) => node.props.testID.includes(id))!,
    );
    const longStyle = styleOfNode(long!);
    const overlapStyle = styleOfNode(overlap!);
    expect(longStyle.top).toBe(18 * 48);
    expect(longStyle.height).toBe(3 * 48 - 1);
    expect(overlapStyle.top).toBe(19.5 * 48);
    expect(longStyle.left).toBe("0%");
    expect(overlapStyle.left).toBe("50%");
    expect(longStyle.width).toBe("50%");
  });

  it("draws the now line at the time now", () => {
    const tree = renderDay(today());
    const now = new Date();
    const [line] = nowLines(tree);
    expect(StyleSheet.flatten(line!.props.style).top).toBe(
      ((now.getHours() * 60 + now.getMinutes()) / 60) * 48 - 1,
    );
  });

  it("lists the day's tasks in the All day strip", () => {
    const due = localIsoDate(today());
    tasks = [
      {
        id: "t-mine",
        title: "Clean the kitchen",
        assignee_id: "me",
        created_by: "m1",
        due_date: due,
        status: "TODO",
      },
    ];
    const tree = renderDay(today());
    expect(screenText(tree)).toContain("All day");
    expect(screenText(tree)).toContain("Clean the kitchen");
  });

  it("says when a block's event is mandatory", () => {
    events = [{ ...EVENT, is_mandatory: true }];
    const tree = renderDay(new Date(EVENT.start_time));
    const [block] = blocks(tree);
    expect(block!.props.accessibilityLabel).toMatch(/, mandatory$/);
  });
});
