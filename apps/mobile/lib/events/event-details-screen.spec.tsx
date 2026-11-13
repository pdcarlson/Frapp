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
import { HeaderButton } from "@/components/header-button";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";
import { formatEventClock } from "@/lib/events/format";

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
// A minute before check-in opens, ten minutes before the start.
const MOUNTED_AT = new Date(START.getTime() - 11 * 60_000);

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
// The viewer's grants: a plain member by default.
let permissions: string[] = ["members:view"];
// `GET …/attendance/me`: not checked in by default.
let myAttendance: unknown = { attendance: null };
// That read's state: settled by default.
let myAttendancePending = false;
let myAttendancePaused = false;
// `GET /v1/events`, which the series section reads: none by default.
let chapterEvents: unknown[] = [];
// Excuses (#3735): whether the event requires the viewer, the viewer's own
// excuse, and the receiver's list.
// `null` reads the event as a viewer with no roles would.
let requiredOfViewer: boolean | null = null;
const viewerId: string | null = "user-me";
let myExcuse: unknown = { excuse: null, receiver: null };
let excuseList: unknown[] = [];
const sendExcuse = vi.fn(async () => ({}));
const decideExcuse = vi.fn(async () => ({}));

const { eventAttendanceFor } = await vi.hoisted(
  async () => await import("@repo/validation"),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  usePermissionList: () => permissions,
  useRoles: () => ({ data: [], isPending: false, isError: false }),
  useEventTypes: () => ({ data: [] }),
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useListChapters: () => ({
    data: [{ chapter_id: "chapter-1", role_ids: [] }],
  }),
  useMyAttendance: () => ({
    isPending: myAttendancePending,
    isPaused: myAttendancePaused,
    data: myAttendancePending ? undefined : myAttendance,
  }),
  useEvents: () => ({ data: chapterEvents }),
  useRequiredOfViewer:
    () => (fields: Parameters<typeof eventAttendanceFor>[0]) =>
      requiredOfViewer ?? eventAttendanceFor(fields, []).status === "required",
  useViewerUserId: () => viewerId,
  useMyEventExcuse: () => ({
    isPending: false,
    isPaused: false,
    data: myExcuse,
  }),
  useEventExcuses: () => ({ data: excuseList }),
  useSendEventExcuse: () => ({ mutateAsync: sendExcuse, isPending: false }),
  useWithdrawEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideEventExcuse: () => ({ mutateAsync: decideExcuse, isPending: false }),
  useEvent: () => ({
    isPending: eventPending,
    isError: false,
    isFetching: false,
    data: event,
    refetch: vi.fn(),
  }),
}));

// The minutes row has its own spec (`components/minutes/event-minutes-row.spec.tsx`).
vi.mock("@/components/minutes/event-minutes-row", () => ({
  EventMinutesRow: () => null,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: ACCENT,
    accentSubtle: ACCENT_SUBTLE,
    accentBorder: "#6B5619",
  }),
}));

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
 * #3022. s07 draws `‹ Calendar` (`‹ Events` before #4610) above the title, in every state: a notification
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

  it("draws ‹ Calendar over a loaded event", () => {
    const tree = render();
    expect(screenText(tree).startsWith("Calendar\nChapter meeting")).toBe(true);
    expectBackRow(tree, "Calendar", "/events");
  });

  it("draws ‹ Calendar over the error state", () => {
    event = null as unknown as typeof EVENT;

    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load this event");
    expectBackRow(tree, "Calendar", "/events");
  });

  it("draws ‹ Calendar while the event loads", () => {
    eventPending = true;

    const tree = render();
    expect(skeletons(tree).length).toBeGreaterThan(0);
    expectBackRow(tree, "Calendar", "/events");
  });

  it("draws ‹ Calendar when the route carries no event id", () => {
    routeId = undefined;

    const tree = render();
    expect(screenText(tree)).toContain("Open an event from the Calendar tab.");
    expectBackRow(tree, "Calendar", "/events");
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
    expect(screenText(tree).startsWith("Calendar\nChapter meeting")).toBe(true);
    expectBackRow(tree, "Calendar", "/events");
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
    permissions = ["members:view"];
    myAttendance = { attendance: null };
    myAttendancePending = false;
    myAttendancePaused = false;
  });

  it("offers no calendar export until calendar sync ships (#3708)", () => {
    expect(screenText(render())).not.toMatch(/add to calendar/i);
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
    // The hairline kind, as the list draws it (#4132).
    expect(flat(textNode(tree, "Mandatory")!).color).toBe(
      signetDarkTokens.color.text.mutedForeground,
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

  it("says only when an upcoming check-in opens (#3703)", () => {
    vi.setSystemTime(new Date(START.getTime() - 30 * 60_000));
    const tree = render();
    const opensAt = new Date(START.getTime() - 10 * 60_000);

    expect(
      textNode(tree, `Check-in opens at ${formatEventClock(opensAt)}`),
    ).toBeDefined();
    expect(screenText(tree)).not.toMatch(/hasn't opened/);
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
  });

  it("swaps the scanner for the member's check-in once they're in (#3703)", () => {
    event = { ...EVENT, point_value: 10 };
    const at = new Date(START.getTime() + 2 * 60_000);
    myAttendance = {
      attendance: {
        id: "a-1",
        status: "PRESENT",
        check_in_time: at.toISOString(),
      },
    };
    const tree = render();

    const title = `Checked in at ${formatEventClock(at)}`;
    expect(textNode(tree, title)).toBeDefined();
    expect(dotColor(tree, title)).toBe(signetDarkTokens.color.semantic.success);
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
    expect(screenText(tree)).not.toContain("Check-in is open");
    // The badge row's chip and the card's line both say the points.
    expect(screenText(tree).match(/\+10 pts/g)).toHaveLength(2);
  });

  it("says an officer's mark and offers no scan the server would refuse", () => {
    myAttendance = {
      attendance: { id: "a-1", status: "EXCUSED", check_in_time: null },
    };
    const tree = render();
    expect(textNode(tree, "Marked excused")).toBeDefined();
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
    // Nothing to do before a deadline: no "closes", no live dot.
    expect(screenText(tree)).not.toMatch(/closes /);
    expect(dotColor(tree, "Marked excused")).toBe(
      signetDarkTokens.color.text.muted,
    );
  });

  it("holds the scanner back while the member's own row is first read", () => {
    myAttendancePending = true;
    expect(textNode(render(), "Scan QR to check in")).toBeUndefined();
  });

  it("offers the scanner when that read is paused offline", () => {
    myAttendancePending = true;
    myAttendancePaused = true;
    expect(textNode(render(), "Scan QR to check in")).toBeDefined();
  });

  it("says only the time before check-in opens, even with a zone", () => {
    vi.setSystemTime(new Date(START.getTime() - 30 * 60_000));
    event = {
      ...EVENT,
      check_in_zone: [[0, 0]],
      check_in_zone_name: "Great Room",
    };
    expect(screenText(render())).not.toContain("Great Room zone");
  });

  it("gives a host Host check-in in place of the scanner (#3703)", () => {
    permissions = ["events:update"];
    const tree = render();

    expect(textNode(tree, "Host check-in")).toBeDefined();
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
    const [host] = tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((text) => text.props.children === "Host check-in").length >
          0,
    );
    act(() => host.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/host-check-in",
      params: { eventId: "evt-1" },
    });
  });

  it("lets a host who attends check themselves in, under the host button", () => {
    permissions = ["events:update"];
    const tree = render();
    const [self] = tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((text) => text.props.children === "Check myself in")
          .length > 0,
    );
    act(() => self.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/check-in",
      params: { eventId: "evt-1" },
    });
  });

  it("offers a host no self check-in once they're in", () => {
    permissions = ["events:update"];
    myAttendance = {
      attendance: {
        id: "a-1",
        status: "PRESENT",
        check_in_time: START.toISOString(),
      },
    };
    expect(textNode(render(), "Check myself in")).toBeUndefined();
  });

  it("offers a host no self check-in before it opens", () => {
    permissions = ["events:update"];
    vi.setSystemTime(new Date(START.getTime() - 30 * 60_000));
    const tree = render();
    expect(textNode(tree, "Host check-in")).toBeDefined();
    expect(textNode(tree, "Check myself in")).toBeUndefined();
  });

  it("opens on the event's own lead, not the default", () => {
    // Twenty minutes before the start: early for the default ten, inside a
    // thirty-minute lead.
    vi.setSystemTime(new Date(START.getTime() - 20 * 60_000));
    event = { ...EVENT, check_in_opens_minutes: 30 };
    const tree = render();
    expect(textNode(tree, "Check-in is open")).toBeDefined();
    expect(textNode(tree, "Scan QR to check in")).toBeDefined();
  });

  it("says when a zero lead opens, at the start itself", () => {
    vi.setSystemTime(new Date(START.getTime() - 5 * 60_000));
    event = { ...EVENT, check_in_opens_minutes: 0 };
    expect(
      textNode(render(), `Check-in opens at ${formatEventClock(START)}`),
    ).toBeDefined();
  });

  it("lets a host put the QR up before check-in opens", () => {
    permissions = ["*"];
    vi.setSystemTime(new Date(START.getTime() - 30 * 60_000));
    expect(textNode(render(), "Host check-in")).toBeDefined();
  });

  it("says a closed window in one line", () => {
    vi.setSystemTime(new Date(START.getTime() + 3 * 60 * 60_000));
    const tree = render();

    expect(screenText(tree)).toContain("Check-in is closed");
    expect(screenText(tree)).not.toContain("window has ended");
    expect(textNode(tree, "Scan QR to check in")).toBeUndefined();
  });
});

describe("Event details editing", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    permissions = ["members:view"];
    event = EVENT;
  });

  function editButton(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Edit event" &&
        node.props.accessibilityRole === "button",
    );
  }

  it("gives a plain member no edit control", () => {
    expect(editButton(render())).toHaveLength(0);
  });

  it("gives anyone who may update events a pencil, on any event", () => {
    // Not the creator: the event carries someone else's id.
    event = { ...EVENT, created_by: "someone-else" };
    permissions = ["members:view", "events:update"];
    expect(editButton(render()).length).toBeGreaterThan(0);
  });

  // #4610 step 3: a bare glyph beside the title was what "buttons are
  // unclear" meant. Every header action sits in the round Chat home drew.
  it("draws the pencil in a round header button", () => {
    permissions = ["members:view", "events:update"];
    const labels = render()
      .root.findAllByType(HeaderButton)
      .map((node) => node.props.label);
    expect(labels).toEqual(["Edit event"]);
  });

  it("gives an owner's wildcard the pencil too", () => {
    permissions = ["*"];
    expect(editButton(render()).length).toBeGreaterThan(0);
  });
});

/**
 * #3707: the Events list draws a series once, so the occurrence's page lists
 * the series' other upcoming dates under its cadence.
 */
describe("Event details series (#3823)", () => {
  const weekly = (index: number) => {
    const start = new Date(START.getTime() + index * 7 * 86_400_000);
    return {
      ...EVENT,
      id: index === 0 ? "evt-1" : `evt-${index + 1}`,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3_600_000).toISOString(),
      recurrence_rule: index === 0 ? "WEEKLY" : null,
      parent_event_id: index === 0 ? null : "evt-1",
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
    event = EVENT;
    chapterEvents = [];
  });

  it("lists the series' other dates under its cadence, each opening its occurrence", () => {
    chapterEvents = [0, 1, 2, 3].map(weekly);
    event = chapterEvents[0] as Record<string, unknown>;
    const tree = render();
    const weekday = START.toLocaleDateString(undefined, { weekday: "long" });
    expect(screenText(tree)).toContain(`Every ${weekday}`);

    const dates = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(
          "Open Chapter meeting, ",
        ),
    );
    expect(dates).toHaveLength(3);
    vi.mocked(expoRouter.useRouter().push).mockClear();
    act(() => dates[0]!.props.onPress());
    expect(expoRouter.useRouter().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-2" },
    });
  });

  it("reads a generated occurrence's cadence off its series head", () => {
    chapterEvents = [0, 1, 2, 3].map(weekly);
    // The common path: the list's series row opens a child, whose own
    // recurrence_rule is null. This one was moved a day later on its own, so
    // its own weekday is not the series'.
    const moved = chapterEvents[1] as Record<string, unknown>;
    const shift = (iso: unknown) =>
      new Date(new Date(String(iso)).getTime() + 86_400_000).toISOString();
    moved.start_time = shift(moved.start_time);
    moved.end_time = shift(moved.end_time);
    event = moved;
    const tree = render();
    const weekday = START.toLocaleDateString(undefined, { weekday: "long" });
    expect(screenText(tree)).toContain(`Every ${weekday}`);
    expect(screenText(tree)).not.toContain("Also in this series");
  });

  it("names an occurrence renamed on its own, on screen and to a screen reader", () => {
    chapterEvents = [0, 1, 2].map(weekly);
    (chapterEvents[2] as Record<string, unknown>).name = "Chapter: Elections";
    event = chapterEvents[0] as Record<string, unknown>;
    const tree = render();
    expect(screenText(tree)).toMatch(/^Chapter: Elections · /m);
    const renamed = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(
          "Open Chapter: Elections, ",
        ),
    );
    expect(renamed).toHaveLength(1);
  });

  it("doesn't name the ordinary dates when the renamed occurrence is open", () => {
    chapterEvents = [0, 1, 2].map(weekly);
    (chapterEvents[2] as Record<string, unknown>).name = "Chapter: Elections";
    event = chapterEvents[2] as Record<string, unknown>;
    const tree = render();
    const rows = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(
          "Open Chapter meeting, ",
        ),
    );
    // The two other dates carry the series' name, so neither says it.
    expect(rows).toHaveLength(2);
    expect(screenText(tree)).not.toMatch(/^Chapter meeting · /m);
  });

  it("draws no series section for a one-time event", () => {
    chapterEvents = [EVENT];
    const tree = render();
    expect(screenText(tree)).not.toMatch(/Every |Also in this series/);
  });
});

describe("Event details excuses (#3735)", () => {
  // The event is a day out: nothing about check-in is in play.
  const TOMORROW = {
    ...EVENT,
    start_time: new Date(START.getTime() + 24 * 3_600_000).toISOString(),
    end_time: new Date(START.getTime() + 25 * 3_600_000).toISOString(),
    created_by: "user-jake",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
    event = TOMORROW;
    requiredOfViewer = true;
    permissions = ["members:view"];
    myAttendance = { attendance: null };
    myExcuse = { excuse: null, receiver: null };
    excuseList = [];
    sendExcuse.mockClear();
    decideExcuse.mockClear();
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
    requiredOfViewer = null;
    permissions = ["members:view"];
    event = EVENT;
  });

  const pressable = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node: ReactTestInstance) =>
        (node.type as unknown) === "Pressable" && screenTextOf(node) === label,
    );
  const screenTextOf = (node: ReactTestInstance): string =>
    node
      .findAll((child) => (child.type as unknown) === "Text")
      .map((child) => child.props.children)
      .flat()
      .join("");

  const excuse = (status: string) => ({
    id: "x-1",
    chapter_id: "chapter-1",
    event_id: "evt-1",
    user_id: "user-me",
    reason: "Exam review",
    status,
    decided_by: null,
    decided_at: null,
    created_at: "2026-09-24T12:00:00Z",
    updated_at: "2026-09-24T12:00:00Z",
  });

  it("offers Can't make it to a member the event requires, and sends the line", async () => {
    const tree = render();
    act(() => pressable(tree, "Can't make it").props.onPress());
    const input = tree.root.find(
      (node) => (node.type as unknown) === "TextInput",
    );
    act(() => input.props.onChangeText("  Exam review "));
    await act(async () => {
      pressable(tree, "Send excuse").props.onPress();
    });
    expect(sendExcuse).toHaveBeenCalledWith({
      eventId: "evt-1",
      reason: "Exam review",
    });
  });

  it("offers nothing on an event that doesn't require the viewer", () => {
    requiredOfViewer = false;
    const tree = render();
    expect(screenText(tree)).not.toContain("Can't make it");
  });

  it("offers nothing to a member already marked excused", () => {
    myAttendance = {
      attendance: { status: "EXCUSED", check_in_time: null, marked_by: "u" },
    };
    const tree = render();
    expect(screenText(tree)).not.toContain("Can't make it");
  });

  it("names the receiver of a pending excuse, or the officers when there is none", () => {
    myExcuse = {
      excuse: excuse("PENDING"),
      receiver: { user_id: "user-jake", display_name: "Jake" },
    };
    expect(screenText(render())).toContain("Excuse sent to Jake");
    myExcuse = { excuse: excuse("PENDING"), receiver: null };
    expect(screenText(render())).toContain("Excuse sent to the officers");
  });

  it("shows the creator their Excuses list, and approves from it", async () => {
    requiredOfViewer = false;
    event = { ...TOMORROW, created_by: "user-me" };
    excuseList = [
      { ...excuse("PENDING"), user_id: "user-sam", display_name: "Sam" },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("1 to decide");
    await act(async () => {
      pressable(tree, "Approve").props.onPress();
    });
    expect(decideExcuse).toHaveBeenCalledWith({
      eventId: "evt-1",
      userId: "user-sam",
      decision: "APPROVED",
    });
  });

  it("shows an officer who didn't make the event the Excuses list", () => {
    requiredOfViewer = false;
    permissions = ["members:view", "events:update"];
    excuseList = [
      { ...excuse("PENDING"), user_id: "user-sam", display_name: "Sam" },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("1 to decide");
    expect(pressable(tree, "Approve")).toBeTruthy();
  });

  it("shows the creator their own excuse without Approve or Decline", () => {
    event = { ...TOMORROW, created_by: "user-me" };
    excuseList = [{ ...excuse("PENDING"), display_name: "Me" }];
    const tree = render();
    expect(screenText(tree)).toContain("Pending");
    expect(screenText(tree)).not.toContain("to decide");
    expect(screenText(tree)).not.toContain("Approve");
  });

  it("keeps the Excuses list from a member who didn't make the event", () => {
    excuseList = [
      { ...excuse("PENDING"), user_id: "user-sam", display_name: "Sam" },
    ];
    expect(screenText(render())).not.toContain("to decide");
  });
});
