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
import * as WebBrowser from "expo-web-browser";
import { signetDarkTokens } from "@repo/theme/signet";
import { AGENDA_CHECK_OFF_LOCKED_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { HeaderButton } from "@/components/header-button";
import { NewEventSheet } from "@/components/events/new-event-sheet";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";
import { formatEventClock } from "@/lib/events/format";
import {
  hasKeptDraft,
  useKeptDraftKeys,
  writeKeptDraft,
} from "@repo/hooks/kept-drafts";

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
  // An officer's screen is up, so a member scans (2026-11-17: without one,
  // and with no zone, the card checks them in with one tap).
  check_in_needs_code: true,
};

let event = EVENT;
// Swapped by the back-row specs for s07's loading and no-event states.
let eventPending = false;
/** The event read's failure, or `null` (#4872: a 404 drops a kept edit). */
let eventError: unknown = null;
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
// Whether that read is still loading: settled by default.
let chapterEventsLoading = false;
// Excuses (#3735): whether the event requires the viewer, the viewer's own
// excuse, and the receiver's list.
// `null` reads the event as a viewer with no roles would.
let requiredOfViewer: boolean | null = null;
const viewerId: string | null = "user-me";
let myExcuse: unknown = { excuse: null, receiver: null };
let excuseList: unknown[] = [];
const sendExcuse = vi.fn(async () => ({}));
const decideExcuse = vi.fn(async () => ({}));

// The chapter (#4934): a module it names `false` is off; `null` while it loads.
let enabledModules: Record<string, boolean> | null = {};
// Whether the event read keeps the event it loaded when it fails, as React
// Query does when a refetch 404s.
let eventDataKept = false;
// Signing a Chapter Files document's link.
const signDocument = vi.fn<(id: string) => Promise<unknown>>(async () => ({
  downloadUrl: "https://files.example/bylaws.pdf",
}));
// The agenda editor's writes, spied rather than sent (its own spec is
// `packages/hooks/src/use-event-agenda.spec.tsx`).
const listsChange = vi.fn();
// Suggested agenda items (#5534), as the hooks hand them over.
let agendaSuggestions: unknown[] = [];
const addSuggestion = vi.fn(async () => {});
const dismissSuggestion = vi.fn(async () => {});
// Whether a write would be lost (offline, a lapsed chapter).
let writeBlockedReason: string | null = null;

const { eventAttendanceFor } = await vi.hoisted(
  async () => await import("@repo/validation"),
);

const checkIn = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  usePermissionList: () => permissions,
  useRoles: () => ({ data: [], isPending: false, isError: false }),
  useEventTypes: () => ({ data: [] }),
  useCreateEventType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useListChapters: () => ({
    data: [{ chapter_id: "chapter-1", role_ids: [] }],
  }),
  useCheckIn: () => ({ mutateAsync: checkIn }),
  useMyAttendance: () => ({
    isPending: myAttendancePending,
    isPaused: myAttendancePaused,
    data: myAttendancePending ? undefined : myAttendance,
  }),
  useEvents: () => ({ data: chapterEvents, isLoading: chapterEventsLoading }),
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
  useEditEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideEventExcuse: () => ({ mutateAsync: decideExcuse, isPending: false }),
  useCurrentChapter: () => ({
    data:
      enabledModules === null
        ? undefined
        : { id: "chapter-1", enabled_modules: enabledModules },
  }),
  useEventListsEditor: (
    _id: string,
    server: { agenda: unknown[]; attachments: unknown[] },
  ) => ({
    ...server,
    saving: false,
    change: listsChange,
    flush: vi.fn(),
    settle: vi.fn(async () => {}),
  }),
  useAgendaSuggestions: () => ({
    suggestions: agendaSuggestions,
    aiAvailable: true,
    loading: false,
    writing: false,
    refreshFailed: false,
    refresh: vi.fn(),
  }),
  useAgendaSuggestionActions: () => ({
    add: addSuggestion,
    dismiss: dismissSuggestion,
    adding: false,
  }),
  useDocuments: () => ({ data: [], isPending: false, isError: false }),
  useDocumentDownloadUrl: () => ({ mutateAsync: signDocument }),
  useEvent: () => ({
    isPending: eventPending,
    isError: eventError !== null,
    error: eventError,
    isFetching: false,
    data: eventError === null || eventDataKept ? event : undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({
    state: "ONLINE",
    isOffline: false,
    isDegraded: false,
    writeBlockedReason,
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
    expect(screenText(tree)).toContain("Open an event from the Calendar.");
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

  it("reads the details before the member's check-in, as web's sheet does (Paul 2026-11-19)", () => {
    const text = screenText(render());
    const details = text.indexOf("DETAILS");
    const checkIn = text.indexOf("Scan code");
    expect(details).toBeGreaterThan(-1);
    expect(checkIn).toBeGreaterThan(details);
  });

  it("carries the Now pill while the event is on, then Ended for the rest of the day (#5777)", () => {
    const tree = render();
    expect(screenText(tree)).toMatch(/Now · until/);
    act(() => {
      // Ten minutes past the end.
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(screenText(tree)).toMatch(/Ended /);
    expect(screenText(tree)).not.toContain("Tonight");
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

  it("draws the open card in the accent, with Scan code and the camera (2026-11-13)", () => {
    const tree = render();

    expect(flat(textNode(tree, "Check-in is open")!).color).toBe(ACCENT);
    const card = tree.root.find(
      (node) =>
        typeof node.type === "string" &&
        flat(node).backgroundColor === ACCENT_SUBTLE,
    );
    expect(card).toBeDefined();

    // The QR is a link the phone's own camera opens, and Scan code reads it
    // in the app; both are said, and Scan code is the card's button
    // (2026-11-17: it was a quieter link a member had to find).
    expect(screenText(tree)).toContain(
      "Scan the code on the officer's screen, here or with your phone's camera.",
    );
    expect(textNode(tree, "Scan code")).toBeDefined();
  });

  it("opens s18 with Scan code's viewport already up", () => {
    vi.mocked(vi.mocked(expoRouter.useRouter)().push).mockClear();
    const tree = render();
    const [scan] = tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((text) => text.props.children === "Scan code").length > 0,
    );
    act(() => scan.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/check-in",
      params: { eventId: "evt-1", scan: "1" },
    });
  });

  it("checks a member in with one tap when nobody is showing a code (2026-11-17)", () => {
    event = { ...EVENT, check_in_needs_code: false };
    checkIn.mockClear();
    checkIn.mockResolvedValue(undefined);
    const tree = render();
    expect(textNode(tree, "Scan code")).toBeUndefined();
    const [tap] = tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((text) => text.props.children === "Check in").length > 0,
    );
    act(() => tap.props.onPress());
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1" });
  });

  it("keeps Scan code for a drawn zone, which needs the location step", () => {
    event = { ...EVENT, check_in_needs_code: false, check_in_zone: [[0, 0]] };
    expect(textNode(render(), "Scan code")).toBeDefined();
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
    expect(textNode(tree, "Scan code")).toBeUndefined();
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
    expect(textNode(tree, "Scan code")).toBeUndefined();
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
    expect(textNode(tree, "Scan code")).toBeUndefined();
    // Nothing to do before a deadline: no "closes", no live dot.
    expect(screenText(tree)).not.toMatch(/closes /);
    expect(dotColor(tree, "Marked excused")).toBe(
      signetDarkTokens.color.text.muted,
    );
  });

  it("holds the scanner back while the member's own row is first read", () => {
    myAttendancePending = true;
    expect(textNode(render(), "Scan code")).toBeUndefined();
  });

  it("offers the typed code when that read is paused offline", () => {
    myAttendancePending = true;
    myAttendancePaused = true;
    expect(textNode(render(), "Scan code")).toBeDefined();
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
    expect(textNode(tree, "Scan code")).toBeUndefined();
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
    checkIn.mockReset();
    checkIn.mockResolvedValue({});
    vi.mocked(vi.mocked(expoRouter.useRouter)().push).mockClear();
    act(() => self.props.onPress());
    // Right there, with no code: the host's own phone shows it (2026-11-17).
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1" });
    expect(vi.mocked(expoRouter.useRouter)().push).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/check-in" }),
    );
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
    expect(textNode(tree, "Scan code")).toBeDefined();
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
    expect(textNode(tree, "Scan code")).toBeUndefined();
  });
});

describe("Event details editing", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    permissions = ["members:view"];
    event = EVENT;
    eventError = null;
  });

  /** The store key the screen's sheet keeps this event's edit under. */
  function keptEditKey(): string {
    let key = "";
    function Probe() {
      key = useKeptDraftKeys().draft(`event-edit:${EVENT.id as string}`);
      return null;
    }
    let probe!: ReactTestRenderer;
    act(() => {
      probe = create(<Probe />);
    });
    act(() => probe.unmount());
    return key;
  }

  it("keeps the edit sheet's draft past this screen, by event (#4872)", () => {
    permissions = ["*"];
    const sheet = render().root.findByType(NewEventSheet);
    expect(sheet.props.keptDraft).toBe(`event-edit:${EVENT.id as string}`);
  });

  // #5310: the Calendar is a pushed screen, so leaving a deleted event pops
  // back down to it rather than pushing a second Calendar over the event.
  it("pops back to the Calendar once the event is deleted", () => {
    permissions = ["*"];
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.dismissTo).mockClear();
    vi.mocked(router.navigate).mockClear();
    vi.mocked(router.push).mockClear();
    const sheet = render().root.findByType(NewEventSheet);
    act(() => sheet.props.onDeleted());
    expect(router.dismissTo).toHaveBeenCalledWith("/events");
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("drops a kept edit once the event is gone (#4872)", () => {
    const key = keptEditKey();
    writeKeptDraft(key, { name: "Chapter" });
    // Still there for a failure that may pass.
    eventError = { statusCode: 500, message: "down" };
    render();
    expect(hasKeptDraft(key)).toBe(true);
    eventError = { statusCode: 404, message: "Event not found" };
    render();
    expect(hasKeptDraft(key)).toBe(false);
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

  // #4746: a Repeat change on a started series steps from its real next
  // meeting, which the sheet reads off the chapter's events.
  describe("a series", () => {
    const head = { ...EVENT, recurrence_rule: "WEEKLY", parent_event_id: null };
    const next = {
      ...EVENT,
      id: "evt-2",
      start_time: "2099-01-07T04:30:00.000Z",
      end_time: "2099-01-07T05:30:00.000Z",
      recurrence_rule: null,
      parent_event_id: "evt-1",
    };
    afterEach(() => {
      chapterEvents = [];
      chapterEventsLoading = false;
    });

    it("hands the edit sheet the series' meetings", () => {
      permissions = ["members:view", "events:update"];
      event = head;
      chapterEvents = [head, next, { ...next, id: "x", parent_event_id: "y" }];
      const sheet = render().root.findByType(NewEventSheet);
      expect(sheet.props.editing.seriesStarts).toEqual([next.start_time]);
    });

    it("holds the pencil while the chapter's events load", () => {
      permissions = ["members:view", "events:update"];
      event = head;
      chapterEventsLoading = true;
      const [button] = editButton(render());
      expect(button!.props.accessibilityState?.disabled).toBe(true);
    });
  });
});

/**
 * A series on the occurrence's page: its cadence in the Repeat row and a
 * link to the next meeting, not the list of every date #3707 drew (Paul
 * 2026-11-19).
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

  const nextLinks = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Next meeting, "),
    );

  it("says the cadence and links the next meeting, not every date (Paul 2026-11-19)", () => {
    chapterEvents = [0, 1, 2, 3].map(weekly);
    event = chapterEvents[0] as Record<string, unknown>;
    const tree = render();
    const weekday = START.toLocaleDateString(undefined, { weekday: "long" });
    expect(screenText(tree)).toContain(`Every ${weekday}`);

    const links = nextLinks(tree);
    expect(links).toHaveLength(1);
    vi.mocked(expoRouter.useRouter().push).mockClear();
    act(() => links[0]!.props.onPress());
    expect(expoRouter.useRouter().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-2" },
    });
  });

  it("links the meeting after the one open, and none after the last", () => {
    chapterEvents = [0, 1, 2].map(weekly);
    event = chapterEvents[1] as Record<string, unknown>;
    const middle = render();
    vi.mocked(expoRouter.useRouter().push).mockClear();
    act(() => nextLinks(middle)[0]!.props.onPress());
    expect(expoRouter.useRouter().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-3" },
    });

    event = chapterEvents[2] as Record<string, unknown>;
    expect(nextLinks(render())).toHaveLength(0);
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
    act(() => pressable(tree, "Can't make it?").props.onPress());
    const input = tree.root.find(
      (node) => (node.type as unknown) === "TextInput",
    );
    act(() => input.props.onChangeText("  Exam review "));
    await act(async () => {
      pressable(tree, "Send").props.onPress();
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
    expect(screenText(render())).toContain("Your excuse · Sent to Jake");
    myExcuse = { excuse: excuse("PENDING"), receiver: null };
    expect(screenText(render())).toContain(
      "Your excuse · Sent to the officers",
    );
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

describe("Event details agenda and attachments (#4934)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    permissions = ["members:view"];
    event = EVENT;
    enabledModules = {};
    writeBlockedReason = null;
    listsChange.mockReset();
    vi.mocked(WebBrowser.openBrowserAsync).mockClear();
    signDocument.mockClear();
  });

  const WITH_LISTS = {
    ...EVENT,
    agenda: [
      { id: "a1", text: "Treasurer's report", done: true },
      { id: "a2", text: "Formal date", done: false },
    ],
    attachments: [
      {
        id: "t1",
        kind: "link",
        url: "https://example.com/budget",
        title: "Budget",
      },
      { id: "t2", kind: "document", document_id: "doc-1", title: "Bylaws" },
    ],
    notes: "Bring dues",
  };

  function labelled(tree: ReactTestRenderer, label: string) {
    return tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel === label,
    );
  }

  it("shows a member the agenda in order and the attachments, read only", () => {
    event = WITH_LISTS;
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("AGENDA");
    expect(text).toContain("Treasurer's report");
    expect(text).toContain("Formal date");
    expect(text).toContain("ATTACHMENTS");
    expect(text).toContain("Budget");
    expect(text).toContain("example.com");
    expect(text).toContain("Bylaws");
    expect(text).toContain("Chapter Files");
    // No editor controls for a member.
    expect(text).not.toContain("Add a link");
    expect(labelled(tree, "Add an agenda item")).toHaveLength(0);
    expect(labelled(tree, `Remove "Formal date"`)).toHaveLength(0);
    // A checked-off item says so to a screen reader.
    expect(labelled(tree, "Done: Treasurer's report")).toHaveLength(1);
  });

  it("leaves both sections out for a member when the event has none", () => {
    const text = screenText(render());
    expect(text).not.toContain("AGENDA");
    expect(text).not.toContain("ATTACHMENTS");
  });

  it("labels the notes NOTES, never internal, while minutes are their own record", () => {
    event = WITH_LISTS;
    const text = screenText(render());
    expect(text).toContain("NOTES");
    expect(text).not.toContain("INTERNAL");
    expect(text).toContain("Bring dues");
  });

  it("labels the notes MEETING MINUTES with the meetings module off", () => {
    event = WITH_LISTS;
    enabledModules = { meetings: false };
    expect(screenText(render())).toContain("MEETING MINUTES");
  });

  it("shows where a tabled agenda item came from, to a member (#5534)", () => {
    event = {
      ...WITH_LISTS,
      agenda: [
        {
          id: "a1",
          text: "Formal budget",
          done: false,
          tabled_from: {
            meeting_id: "m-first",
            start_time: "2026-11-11T23:00:00.000Z",
            times: 2,
          },
        },
      ],
    };
    const tree = render();
    const link = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "link" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Tabled from") &&
        typeof node.props.onPress === "function",
    );
    expect(link.props.accessibilityLabel).toContain("2nd time");
  });

  it("never shows Suggested to a member, or for a meeting that has ended (#5534)", () => {
    agendaSuggestions = [
      {
        id: "s1",
        kind: "ai",
        text: "Venue check-in",
        tabled_from: null,
        source_meeting_id: "m-last",
        reason: null,
      },
    ];
    // A member, on an upcoming meeting.
    event = {
      ...WITH_LISTS,
      start_time: "2099-01-01T18:00:00.000Z",
      end_time: "2099-01-01T19:00:00.000Z",
    };
    expect(screenText(render())).not.toContain("SUGGESTED");
    // An editor, on a meeting that has ended.
    permissions = ["members:view", "events:update"];
    event = WITH_LISTS;
    expect(screenText(render())).not.toContain("SUGGESTED");
    agendaSuggestions = [];
  });

  it("offers Suggested items to an editor of an upcoming meeting, with Add and Dismiss (#5534)", async () => {
    event = {
      ...WITH_LISTS,
      start_time: "2099-01-01T18:00:00.000Z",
      end_time: "2099-01-01T19:00:00.000Z",
    };
    permissions = ["members:view", "events:update"];
    agendaSuggestions = [
      {
        id: "s1",
        kind: "ai",
        text: "Venue check-in",
        tabled_from: null,
        source_meeting_id: "m-last",
        reason: "Still open from last week",
      },
    ];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("SUGGESTED");
    expect(text).toContain("Venue check-in");
    expect(text).toContain("Still open from last week");
    const dismiss = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === 'Dismiss "Venue check-in"' &&
        typeof node.props.onPress === "function",
    );
    await act(async () => dismiss.props.onPress());
    expect(dismissSuggestion).toHaveBeenCalledWith("s1");
    const add = tree.root.find(
      (node) =>
        node.props.accessibilityHint === 'Add "Venue check-in" to the agenda' &&
        typeof node.props.onPress === "function",
    );
    await act(async () => add.props.onPress());
    expect(addSuggestion).toHaveBeenCalledWith("s1");
    agendaSuggestions = [];
  });

  it("lets an events:update holder check an item off in place", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    const tree = render();
    const box = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "checkbox" &&
        node.props.accessibilityLabel === "Formal date" &&
        typeof node.props.onPress === "function",
    );
    act(() => box.props.onPress());
    expect(listsChange).toHaveBeenCalledTimes(1);
    const [field, update] = listsChange.mock.calls[0] as [
      string,
      (current: unknown) => unknown,
    ];
    expect(field).toBe("agenda");
    expect(update(WITH_LISTS.agenda)).toEqual([
      WITH_LISTS.agenda[0],
      { id: "a2", text: "Formal date", done: true },
    ]);
    expect(screenText(tree)).toContain("Attach from Chapter Files");
  });

  it("adds an item from the field under the list", () => {
    permissions = ["members:view", "events:update"];
    const tree = render();
    // An editor sees the empty agenda, to start it.
    expect(screenText(tree)).toContain("AGENDA");
    const field = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Add an agenda item" &&
        typeof node.props.onSubmitEditing === "function",
    );
    act(() => field.props.onChangeText("  Rush   plans "));
    act(() => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Add an agenda item" &&
            typeof node.props.onSubmitEditing === "function",
        )
        .props.onSubmitEditing();
    });
    const [field0, update] = listsChange.mock.calls[0] as [
      string,
      (current: unknown[]) => { text: string; done: boolean }[],
    ];
    expect(field0).toBe("agenda");
    const next = update([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ text: "Rush plans", done: false });
  });

  it("offers no Chapter Files picker while that module is off", () => {
    permissions = ["members:view", "events:update"];
    enabledModules = { documents: false };
    const text = screenText(render());
    expect(text).toContain("Add a link");
    expect(text).not.toContain("Attach from Chapter Files");
  });

  it("offers no controls while writes are blocked, and still reads the lists", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    writeBlockedReason = "You're offline.";
    const tree = render();
    expect(screenText(tree)).toContain("Formal date");
    expect(screenText(tree)).not.toContain("Add a link");
    expect(labelled(tree, `Remove "Formal date"`)).toHaveLength(0);
  });

  it("offers no controls on an event deleted since it loaded", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    // The refetch 404s, and the screen still holds the event it loaded.
    eventError = { statusCode: 404, message: "Event not found" };
    eventDataKept = true;
    const tree = render();
    expect(screenText(tree)).toContain("Formal date");
    expect(screenText(tree)).not.toContain("Add a link");
    expect(labelled(tree, `Remove "Formal date"`)).toHaveLength(0);
    eventError = null;
    eventDataKept = false;
  });

  it("shows the agenda in its order, numbered for a member", () => {
    event = WITH_LISTS;
    const text = screenText(render());
    expect(text.indexOf("Treasurer's report")).toBeLessThan(
      text.indexOf("Formal date"),
    );
    expect(text).toContain("2.");
  });

  /** The agenda's rows, each measured as a phone would lay them out. */
  function agendaRows(tree: ReactTestRenderer) {
    const rows = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Animated.View" &&
        Array.isArray(node.props.accessibilityActions),
    );
    act(() =>
      rows.forEach((row, index) =>
        row.props.onLayout({
          nativeEvent: {
            layout: { x: 0, y: index * 48, width: 300, height: 44 },
          },
        }),
      ),
    );
    return rows;
  }

  function lastAgendaOrder() {
    const [, update] = listsChange.mock.calls.at(-1) as [
      string,
      (current: unknown) => { id: string }[],
    ];
    return update(WITH_LISTS.agenda).map((item) => item.id);
  }

  it("moves an item up by dragging its grip (Paul 2026-11-19)", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    const tree = render();
    agendaRows(tree);
    // No arrows any more: the grip is the way.
    expect(labelled(tree, `Move "Formal date" up`)).toHaveLength(0);
    const grips = tree.root.findAll(
      (node) => (node.type as unknown) === "GestureDetector",
    );
    const pan = grips[1]!.props.gesture as {
      handlers: Record<string, (event?: unknown) => void>;
    };
    act(() => {
      pan.handlers.onBegin!();
      pan.handlers.onUpdate!({ translationY: -60 });
      pan.handlers.onFinalize!();
    });
    expect(lastAgendaOrder()).toEqual(["a2", "a1"]);
  });

  it("leaves the order alone for a drag that doesn't pass a neighbour", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    const tree = render();
    agendaRows(tree);
    const pan = tree.root.findAll(
      (node) => (node.type as unknown) === "GestureDetector",
    )[0]!.props.gesture as {
      handlers: Record<string, (event?: unknown) => void>;
    };
    act(() => {
      pan.handlers.onBegin!();
      pan.handlers.onUpdate!({ translationY: 10 });
      pan.handlers.onFinalize!();
    });
    expect(listsChange).not.toHaveBeenCalled();
  });

  it("moves an item with a screen reader's Move up", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    const tree = render();
    const [first, second] = agendaRows(tree);
    // The first item can't go up, the last can't go down.
    expect(first!.props.accessibilityActions).toEqual([
      { name: "moveDown", label: "Move down" },
    ]);
    act(() =>
      second!.props.onAccessibilityAction({
        nativeEvent: { actionName: "moveUp" },
      }),
    );
    expect(lastAgendaOrder()).toEqual(["a2", "a1"]);
  });

  it("holds the checkboxes until the meeting starts, and says why once", () => {
    const start = Date.now() + 2 * 86_400_000;
    event = {
      ...WITH_LISTS,
      start_time: new Date(start).toISOString(),
      end_time: new Date(start + 3_600_000).toISOString(),
    };
    permissions = ["members:view", "events:update"];
    const tree = render();
    const boxes = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "checkbox",
    );
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box.props.disabled).toBe(true);
    const text = screenText(tree);
    expect(text.split(AGENDA_CHECK_OFF_LOCKED_COPY).length - 1).toBe(1);
    // No "done" count before there is anything to count.
    expect(text).not.toContain("of 2 done");
  });

  it("counts what's done once the meeting has started", () => {
    event = WITH_LISTS;
    permissions = ["members:view", "events:update"];
    const text = screenText(render());
    expect(text).toContain("1 of 2 done");
    expect(text).not.toContain(AGENDA_CHECK_OFF_LOCKED_COPY);
  });

  it("offers no Chapter Files picker until the chapter says the module is on, and calls the notes Notes meanwhile", () => {
    permissions = ["members:view", "events:update"];
    event = WITH_LISTS;
    enabledModules = null;
    const text = screenText(render());
    expect(text).toContain("Add a link");
    expect(text).not.toContain("Attach from Chapter Files");
    expect(text).toContain("NOTES");
    expect(text).not.toContain("MEETING MINUTES");
  });

  function attachmentRow(tree: ReactTestRenderer, prefix: string) {
    return tree.root.find(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith(prefix) &&
        typeof node.props.onPress === "function",
    );
  }

  it("opens a link in the in-app browser", async () => {
    event = WITH_LISTS;
    const tree = render();
    await act(async () => attachmentRow(tree, "Budget,").props.onPress());
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://example.com/budget",
    );
  });

  it("says when a link won't open", async () => {
    event = WITH_LISTS;
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(
      new Error("Another web browser is already open"),
    );
    const tree = render();
    await act(async () => attachmentRow(tree, "Budget,").props.onPress());
    expect(screenText(tree)).toContain("Couldn't open that link");
  });

  it("opens a document through its signed link", async () => {
    event = WITH_LISTS;
    const tree = render();
    await act(async () => attachmentRow(tree, "Bylaws,").props.onPress());
    expect(signDocument).toHaveBeenCalledWith("doc-1");
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://files.example/bylaws.pdf",
    );
  });

  it("says a document deleted since it was attached is gone", async () => {
    event = WITH_LISTS;
    signDocument.mockRejectedValueOnce({
      statusCode: 404,
      message: "Not found",
    });
    const tree = render();
    await act(async () => attachmentRow(tree, "Bylaws,").props.onPress());
    expect(screenText(tree)).toContain("That file is gone from Chapter Files");
  });
});
