/** @vitest-environment jsdom */
import { MemberFacingError } from "@repo/hooks/error-copy";
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import type { EventPayload } from "@repo/chat-core/cards";
import { moduleDisabledMessage } from "@repo/validation";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { formatEventWindow } from "@/lib/events/format";
import { CHECK_IN_NEEDS_CODE_MESSAGE } from "@/lib/events/check-in-outcome";
import * as expoRouter from "expo-router";

/**
 * The mobile chat event card (#3185): the snapshot, the officer-only count,
 * and inline Check-in with s18's outcomes. The hooks are stubbed; the window,
 * outcome and module rules run for real.
 */

const state = vi.hoisted(() => ({
  now: new Date("2026-11-05T23:30:00.000Z"),
  permissions: [] as string[],
  attendance: undefined as unknown,
  event: undefined as unknown,
  eventError: false,
  enabledModules: {} as Record<string, boolean> | undefined,
  writeBlockedReason: null as string | null,
  attendanceIds: [] as string[],
  eventIds: [] as string[],
  mine: undefined as unknown,
  mineIds: [] as string[],
}));
const checkIn = vi.hoisted(() => vi.fn());
const requireForegroundFix = vi.hoisted(() => vi.fn());
const refetchEvent = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useNowDate: () => state.now,
  usePermissionList: () => state.permissions,
  useAttendance: (id: string) => {
    state.attendanceIds.push(id);
    return { data: id ? state.attendance : undefined };
  },
  useEvent: (id: string) => {
    state.eventIds.push(id);
    return id
      ? {
          data: state.event,
          isError: state.eventError,
          refetch: () => refetchEvent(),
        }
      : { data: undefined, isError: false, refetch: () => refetchEvent() };
  },
  useMyAttendance: (id: string) => {
    state.mineIds.push(id);
    return { data: id ? state.mine : undefined };
  },
  useCheckIn: () => ({ mutateAsync: checkIn, isPending: false }),
  useCurrentChapter: () => ({
    data:
      state.enabledModules === undefined
        ? undefined
        : { enabled_modules: state.enabledModules },
  }),
}));

vi.mock("@/lib/location", () => ({
  requireForegroundFix: (copy: string) => requireForegroundFix(copy),
  latLngOf: (fix: { lat: number; lng: number }) => ({
    lat: fix.lat,
    lng: fix.lng,
  }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { EventCard } from "./event-card";
import { CardMeta } from "./chat-card";

/** Inside the window: it started at 23:00 and ends at 00:00. */
const PAYLOAD: EventPayload = {
  event_id: "evt-1",
  name: "Chapter meeting",
  start_time: "2026-11-05T23:00:00.000Z",
  end_time: "2026-11-06T00:00:00.000Z",
  location: "Great Hall",
  point_value: 10,
  is_mandatory: true,
  check_in_opens_minutes: 10,
  created_at: "2026-11-01T12:00:00.000Z",
};

const EVENT_ROW = {
  id: "evt-1",
  name: "Chapter meeting",
  start_time: PAYLOAD.start_time,
  end_time: PAYLOAD.end_time,
  point_value: 10,
  is_mandatory: true,
  check_in_zone: [] as unknown[],
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "system",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "New event: Chapter meeting",
    kind: "event",
    payload: PAYLOAD,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: "2026-11-01T12:00:00.000Z",
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as unknown as ChatMessage;
}

function render(
  options: { payload?: EventPayload; isConfirmed?: boolean } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventCard
          message={message()}
          payload={options.payload ?? PAYLOAD}
          viewerId="viewer-1"
          isConfirmed={options.isConfirmed ?? true}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The same card element `render()` mounts, for `tree.update` after state changes. */
function rerenderCard() {
  return (
    <FrappThemeProvider>
      <EventCard
        message={message()}
        payload={PAYLOAD}
        viewerId="viewer-1"
        isConfirmed
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />
    </FrappThemeProvider>
  );
}

function button(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  );
}

function hasButton(tree: ReactTestRenderer, label: string): boolean {
  return (
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    ).length > 0
  );
}

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    button(tree, label).props.onPress();
  });
}

beforeEach(() => {
  state.now = new Date("2026-11-05T23:30:00.000Z");
  state.permissions = [];
  state.attendance = undefined;
  state.event = EVENT_ROW;
  state.eventError = false;
  state.enabledModules = {};
  state.writeBlockedReason = null;
  state.attendanceIds = [];
  state.eventIds = [];
  state.mine = { attendance: null };
  state.mineIds = [];
  checkIn.mockReset().mockResolvedValue({});
  requireForegroundFix.mockReset();
  refetchEvent.mockReset().mockResolvedValue({ data: undefined });
});

describe("EventCard — the snapshot", () => {
  it("draws the name, the location, the points and the Mandatory chip", () => {
    const text = screenText(render());
    expect(text).toContain("Event");
    expect(text).toContain("Chapter meeting");
    expect(text).toContain("Great Hall");
    expect(text).toContain("+10 pts");
    expect(text).toContain("Mandatory");
  });

  it("draws Mandatory red, as every other Mandatory card does (#3830)", () => {
    const chip = render().root.findByProps({ label: "Mandatory" });
    expect(chip.props.hue).toBe(signetDarkTokens.color.semantic.destructive);
  });

  it("draws when it is in the viewer's own time, not the server's sentence", () => {
    const text = screenText(render());
    // The formatter's own zone cases are `lib/events/format.spec.ts`'s; here,
    // that the card draws its line and not the UTC-built `content`.
    expect(text).toContain(
      formatEventWindow(PAYLOAD.start_time, PAYLOAD.end_time, state.now),
    );
    expect(text).not.toContain("New event:");
  });

  it("draws the time, the place and the rest as lines of their own", () => {
    // One `CardMeta` per line: run together, a phone wraps them and the
    // wrapped line starts with a stray separator. `screenText` joins every
    // node, so the lines are read one `CardMeta` at a time.
    const lines = render()
      .root.findAllByType(CardMeta)
      .map((line) => drawnText(line));
    expect(lines).toEqual([
      formatEventWindow(PAYLOAD.start_time, PAYLOAD.end_time, state.now),
      "Great Hall",
      "+10 pts",
    ]);
  });

  it("leaves out what the payload doesn't carry", () => {
    const text = screenText(
      render({
        payload: {
          ...PAYLOAD,
          location: null,
          point_value: 0,
          is_mandatory: false,
        },
      }),
    );
    expect(text).not.toContain("pts");
    expect(text).not.toContain("Mandatory");
    expect(text).not.toContain("Great Hall");
  });
});

describe("EventCard — the checked-in count", () => {
  it("is drawn for an officer who can read the roster, PRESENT and LATE only", () => {
    state.permissions = ["events:update"];
    state.attendance = [
      { status: "PRESENT" },
      { status: "LATE" },
      { status: "ABSENT" },
    ];
    expect(screenText(render())).toContain("2 checked in");
  });

  it("is never asked for, or drawn, for a member", () => {
    state.attendance = [{ status: "PRESENT" }];
    const text = screenText(render());
    expect(state.attendanceIds.every((id) => id === "")).toBe(true);
    expect(text).not.toContain("checked in");
  });

  it("waits for the roster rather than drawing a 0 that isn't true yet", () => {
    state.permissions = ["events:update"];
    state.attendance = undefined;
    expect(screenText(render())).not.toContain("checked in");
  });
});

describe("EventCard — Check in", () => {
  it("is offered only inside the window, the lead and the 15-minute grace included", () => {
    // Ten minutes before the 23:00 start is the default lead (#3703).
    state.now = new Date("2026-11-05T22:49:00.000Z");
    expect(hasButton(render(), "Check in")).toBe(false);
    state.now = new Date("2026-11-05T22:51:00.000Z");
    expect(hasButton(render(), "Check in")).toBe(true);
    state.now = new Date("2026-11-06T00:14:00.000Z");
    expect(hasButton(render(), "Check in")).toBe(true);
    state.now = new Date("2026-11-06T00:16:00.000Z");
    expect(hasButton(render(), "Check in")).toBe(false);
  });

  it("opens on the card's own lead, not the default", () => {
    // Thirty minutes ahead of the 23:00 start: open at 22:35, which the
    // default ten would still call early.
    state.now = new Date("2026-11-05T22:35:00.000Z");
    const payload = { ...PAYLOAD, check_in_opens_minutes: 30 };
    expect(hasButton(render({ payload }), "Check in")).toBe(true);
    expect(
      hasButton(
        render({ payload: { ...PAYLOAD, check_in_opens_minutes: 0 } }),
        "Check in",
      ),
    ).toBe(false);
  });

  it("doesn't read the event outside the window", () => {
    state.now = new Date("2026-11-04T12:00:00.000Z");
    render();
    expect(state.eventIds.every((id) => id === "")).toBe(true);
  });

  it("checks in without a position on an event with no zone, then says so", async () => {
    const tree = render();
    await press(tree, "Check in");
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1" });
    expect(requireForegroundFix).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("You're checked in. +10 pts");
    expect(button(tree, "Checked in").props.disabled).toBe(true);
    expect(hasButton(tree, "Check in")).toBe(false);
  });

  it("sends the member's position when the event has a zone", async () => {
    state.event = { ...EVENT_ROW, check_in_zone: [[1, 2]] };
    requireForegroundFix.mockResolvedValue({ lat: 42.73, lng: -73.68 });
    const tree = render();
    expect(screenText(tree)).toContain("checks you in by location");
    await press(tree, "Check in");
    expect(requireForegroundFix).toHaveBeenCalledOnce();
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "evt-1",
      lat: 42.73,
      lng: -73.68,
    });
  });

  it("turns Check in into Scan code once the officer's screen wants the code (#4532)", async () => {
    vi.mocked(vi.mocked(expoRouter.useRouter)().push).mockClear();
    checkIn.mockRejectedValue({
      statusCode: 403,
      message: CHECK_IN_NEEDS_CODE_MESSAGE,
    });
    const tree = render();
    await press(tree, "Check in");
    expect(screenText(tree)).toContain(
      "Scan the code on the officer's screen with the Frapp app to check in.",
    );
    await press(tree, "Scan code");
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/check-in",
      params: { eventId: "evt-1" },
    });
  });

  it("says why when location access is refused, and leaves the button to retry", async () => {
    state.event = { ...EVENT_ROW, check_in_zone: [[1, 2]] };
    requireForegroundFix.mockRejectedValue(
      new MemberFacingError("Allow location access."),
    );
    const tree = render();
    await press(tree, "Check in");
    expect(checkIn).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Allow location access.");
    expect(button(tree, "Check in").props.disabled).toBe(false);
  });

  it("waits to learn whether there's a zone before it can be pressed", () => {
    state.event = undefined;
    expect(button(render(), "Check in").props.disabled).toBe(true);
    state.eventError = true;
    expect(button(render(), "Check in").props.disabled).toBe(false);
  });

  it("asks about the zone again on the tap when the read failed", async () => {
    state.event = undefined;
    state.eventError = true;
    refetchEvent.mockResolvedValue({
      data: { ...EVENT_ROW, check_in_zone: [[1, 2]] },
    });
    requireForegroundFix.mockResolvedValue({ lat: 42.73, lng: -73.68 });
    await press(render(), "Check in");
    expect(refetchEvent).toHaveBeenCalledOnce();
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "evt-1",
      lat: 42.73,
      lng: -73.68,
    });
  });

  it("sends no position when the second read fails too; the server decides", async () => {
    state.event = undefined;
    state.eventError = true;
    await press(render(), "Check in");
    expect(requireForegroundFix).not.toHaveBeenCalled();
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1" });
  });

  it("reads a 409 as already checked in", async () => {
    checkIn.mockRejectedValue({ statusCode: 409, message: "Conflict" });
    const tree = render();
    await press(tree, "Check in");
    expect(screenText(tree)).toContain(
      "You're already checked in for this event.",
    );
    expect(button(tree, "Checked in").props.disabled).toBe(true);
  });

  it("tells a member about a lapsed subscription in their words, and stops", async () => {
    checkIn.mockRejectedValue({
      statusCode: 403,
      error: "Forbidden",
      message:
        "Chapter subscription is not active; complete checkout to use this feature.",
    });
    const tree = render();
    await press(tree, "Check in");
    const text = screenText(tree);
    expect(text).toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
    expect(text).not.toContain("complete checkout");
    const retry = button(tree, "Check in");
    expect(retry.props.disabled).toBe(true);
    expect(retry.props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.checkIn,
    );
  });

  it("relays any other refusal and leaves the button to retry", async () => {
    checkIn.mockRejectedValue({
      statusCode: 400,
      message: "Check-in is only allowed during the event time window",
    });
    const tree = render();
    await press(tree, "Check in");
    expect(screenText(tree)).toContain(
      "You can only check in while the event is on.",
    );
    expect(button(tree, "Check in").props.disabled).toBe(false);
  });

  it("can't be pressed while a write would be lost, and says why", () => {
    state.writeBlockedReason = "Reconnect to make changes.";
    const checkInButton = button(render(), "Check in");
    expect(checkInButton.props.disabled).toBe(true);
    expect(checkInButton.props.accessibilityHint).toBe(
      "Reconnect to make changes.",
    );
  });

  it("can't be pressed on a row the server hasn't acknowledged", () => {
    expect(
      button(render({ isConfirmed: false }), "Check in").props.disabled,
    ).toBe(true);
  });

  it("gives way to the module note once Events is known to be off", () => {
    state.enabledModules = { events: false };
    const tree = render();
    expect(hasButton(tree, "Check in")).toBe(false);
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.checkIn);
  });

  it("still checks in while the chapter read is in flight; the server decides", () => {
    state.enabledModules = undefined;
    expect(button(render(), "Check in").props.disabled).toBe(false);
  });

  it("relays a module refusal in the member's words", async () => {
    checkIn.mockRejectedValue({
      statusCode: 403,
      error: "Forbidden",
      message: moduleDisabledMessage("events"),
    });
    const tree = render();
    await press(tree, "Check in");
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.checkIn);
  });
});

describe("EventCard — already on the list", () => {
  it("says Checked in for a member who checked in somewhere else", () => {
    // Scanned at the door, another device, or this card before it scrolled
    // away and remounted: the local outcome is gone, the server's row isn't.
    state.mine = {
      attendance: { status: "PRESENT", check_in_time: "2026-11-05T23:10:00.000Z" },
    };
    const tree = render();
    expect(button(tree, "Checked in").props.disabled).toBe(true);
    expect(hasButton(tree, "Check in")).toBe(false);
  });

  it("shows an officer's mark instead of offering a check-in it can't replace", () => {
    state.mine = { attendance: { status: "EXCUSED", check_in_time: null } };
    const tree = render();
    expect(screenText(tree)).toContain("Marked excused");
    expect(hasButton(tree, "Check in")).toBe(false);
  });

  it("shows an officer's mark, not Checked in, when the tap's 409 was the mark", async () => {
    // The row read before the officer marked the member; the server refuses
    // the check-in for any existing row, and the re-read row says which.
    checkIn.mockRejectedValue({ statusCode: 409, message: "Already checked in" });
    const tree = render();
    await press(tree, "Check in");
    state.mine = { attendance: { status: "EXCUSED", check_in_time: null } };
    act(() => tree.update(rerenderCard()));
    expect(screenText(tree)).toContain("Marked excused");
    expect(hasButton(tree, "Checked in")).toBe(false);
  });

  it("drops an earlier failure once the member's row says checked in", async () => {
    checkIn.mockRejectedValue(new Error("network down"));
    const tree = render();
    await press(tree, "Check in");
    const failure = screenText(tree);
    state.mine = {
      attendance: { status: "PRESENT", check_in_time: "2026-11-05T23:10:00.000Z" },
    };
    act(() => tree.update(rerenderCard()));
    expect(button(tree, "Checked in").props.disabled).toBe(true);
    expect(failure).toContain("check you in");
    expect(screenText(tree)).not.toContain("check you in");
  });

  it("offers Check in while the member has no row", () => {
    const tree = render();
    expect(hasButton(tree, "Check in")).toBe(true);
  });

  it("doesn't read the member's row outside the window", () => {
    state.now = new Date("2026-11-04T12:00:00.000Z");
    render();
    expect(state.mineIds.every((id) => id === "")).toBe(true);
  });
});
