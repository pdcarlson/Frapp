/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AccessibilityInfo, Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText, textHeadings } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import {
  CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
  FrappClientProvider,
} from "@repo/hooks";
import {
  ALREADY_CHECKED_IN_COPY,
  CHECK_IN_CODE_REFUSED_MESSAGE,
} from "@/lib/events/check-in-outcome";
import { requireForegroundFix } from "@/lib/location";

/**
 * s18's refusal wiring (#2297), rendered (#2416).
 *
 * A subscription refusal is the one check-in failure that must not re-arm
 * anything: the chapter stays refused until an officer sorts out billing, so
 * a live scanner or manual field only invites a retry that cannot win. Every
 * other failure keeps both armed. And because a tab screen is never unmounted,
 * the refusal has to clear when the member comes back, or the scanner stays
 * dead at the next event until a force-quit.
 *
 * These replace source-string locks that proved a token was in the file, not
 * that the scanner was off. Reverting the catch to a plain `error` status
 * kept those green; it turns this suite red.
 *
 * It renders `app/(tabs)/check-in.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Check-in service is unavailable.",
  requestId: "req_failed",
};
/** What a member reads for {@link FAILED}: never the server's own text. */
const FAILED_SHOWN = "Couldn't check you in.";

const EVENT = {
  id: "evt-1",
  name: "Chapter meeting",
  location: null,
  start_time: "2026-09-25T18:00:00Z",
  end_time: "2026-09-25T19:00:00Z",
  point_value: 10,
  is_mandatory: false,
  check_in_zone: [],
};

/** The event the reused tab instance can move to mid check-in. */
const OTHER_EVENT = { ...EVENT, id: "evt-2", name: "Formal", point_value: 5 };

const checkIn = vi.fn();

const state = vi.hoisted(() => ({
  writeBlockedReason: null as string | null,
  successHaptic: vi.fn(),
  /** Stands in for `useEvent` when set; reset by the specs that set it. */
  useEvent: null as null | ((id: string) => Record<string, unknown>),
  /** Check-ins sent and not yet answered, for `useCheckIn`'s `isPending`. */
  pendingCheckIns: 0,
  /**
   * The real `useCheckIn`, on the client `renderWithClient` provides, for a
   * spec that has to see what the hook makes of a response. Set for the life
   * of one tree.
   */
  realCheckIn: false,
}));

/**
 * `useCheckIn`'s `mutateAsync`: sends through `checkIn`, and counts what is
 * on its way so the mock's `isPending` is true while a check-in is, as
 * TanStack's is. A screen that read it would switch the next event's Check in
 * off while the last event's check-in is still on its way.
 */
function sendCheckIn(variables: unknown) {
  state.pendingCheckIns += 1;
  const answer = Promise.resolve(checkIn(variables));
  const settle = () => {
    state.pendingCheckIns -= 1;
  };
  answer.then(settle, settle);
  return answer;
}

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    ...actual,
    useEvent: (id: string) =>
      state.useEvent
        ? state.useEvent(id)
        : { data: id === OTHER_EVENT.id ? OTHER_EVENT : EVENT },
    useCheckIn: () =>
      state.realCheckIn
        ? actual.useCheckIn()
        : { mutateAsync: sendCheckIn, isPending: state.pendingCheckIns > 0 },
  };
});

beforeEach(() => {
  state.pendingCheckIns = 0;
});

vi.mock("@/lib/haptics", () => ({
  successHaptic: () => state.successHaptic(),
}));
const { successHaptic } = state;

vi.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, vi.fn()],
}));

// The event has no zone, so the screen never asks for a fix; mocked only so
// `expo-location` is not loaded.
vi.mock("@/lib/location", () => ({
  requireForegroundFix: vi.fn(),
  latLngOf: (fix: { lat: number; lng: number }) => ({
    lat: fix.lat,
    lng: fix.lng,
  }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import CheckInScreen from "@/app/(tabs)/check-in";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void })
  .__refocus;
/** "The member left this screen": the other half of `__refocus`. */
const blur = (expoRouter as unknown as { __blur: () => void }).__blur;

/**
 * What the screen's `sheetRef` holds. The bottom-sheet mock is a host string,
 * whose ref react-test-renderer leaves null unless a node mock stands in, and
 * with a null ref `useSheetVisit`'s dismiss does nothing, so a spec could not
 * tell a dismiss from none.
 */
const sheetHandle = { present: vi.fn(), dismiss: vi.fn() };

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <CheckInScreen />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          element.type === "BottomSheetModal" ? sheetHandle : null,
      },
    );
  });
  return tree;
}

/**
 * The screen on the real `useCheckIn` (`state.realCheckIn`), which sends
 * through `client`.
 */
function renderWithClient(client: unknown): ReactTestRenderer {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: 0 } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <CheckInScreen />
          </FrappThemeProvider>
        </QueryClientProvider>
      </FrappClientProvider>,
      {
        createNodeMock: (element) =>
          element.type === "BottomSheetModal" ? sheetHandle : null,
      },
    );
  });
  return tree;
}

/** The screen as it renders after its params or its hooks changed. */
function rerender(tree: ReactTestRenderer) {
  act(() =>
    tree.update(
      <FrappThemeProvider>
        <CheckInScreen />
      </FrappThemeProvider>,
    ),
  );
}

/** The reused tab instance moves to another event. */
function moveTo(tree: ReactTestRenderer, eventId: string) {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ eventId });
  rerender(tree);
}

/** A check-in whose answer the spec decides when to deliver. */
function pendingCheckIn() {
  const answer: { land: () => void; refuse: (error: unknown) => void } = {
    land: () => undefined,
    refuse: () => undefined,
  };
  checkIn.mockReturnValue(
    new Promise<void>((resolve, reject) => {
      answer.land = () => resolve();
      answer.refuse = reject;
    }),
  );
  return answer;
}

/**
 * Check-ins whose answers the spec delivers one by one, in the order they
 * were sent.
 */
function pendingCheckIns() {
  const answers: { land: () => void; refuse: (error: unknown) => void }[] = [];
  checkIn.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        answers.push({ land: () => resolve(), refuse: reject });
      }),
  );
  return answers;
}

/** The manual code field in the sheet. */
const manualInput = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) => node.props.accessibilityLabel === "Manual check-in code",
  );

/** Opens the manual sheet the way the member does, and lets it finish rising. */
function openSheet(tree: ReactTestRenderer) {
  act(() => pressableDrawing(tree, "Enter code manually").props.onPress());
  act(() =>
    tree.root.findByType("BottomSheetModal" as never).props.onAnimate(-1, 0),
  );
}

const camera = (tree: ReactTestRenderer) =>
  tree.root.findByType("CameraView" as never);

/** The manual sheet's "Check in" button (`SheetPrimaryButton`). */
const manualSubmit = (tree: ReactTestRenderer) =>
  tree.root
    .findByType("BottomSheetModal" as never)
    .find(
      (node) =>
        node.type === ("Pressable" as never) &&
        drawnText(node) === "Check in",
    );

/** A control found by what it draws. */
const pressableDrawing = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) && drawnText(node) === label,
  );

/** Types a plausible code and submits it, settling the async submit. */
async function submitManualCode(tree: ReactTestRenderer) {
  act(() => manualInput(tree).props.onChangeText("4KQ88"));
  await act(async () => {
    manualSubmit(tree).props.onPress();
  });
}

describe("Check-in on a subscription refusal (#2297)", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
  });

  it("explains the refusal and switches the scanner and manual submit off", async () => {
    checkIn.mockRejectedValue(REFUSED);
    const tree = render();
    await submitManualCode(tree);

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
    // The server's own words are a purchase instruction, which the store
    // declaration forbids inside the app.
    expect(screenText(tree)).not.toContain(REFUSED.message);
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();
    expect(manualSubmit(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps the scanner and manual submit armed after an ordinary failure", async () => {
    // The direction that got an earlier attempt at #2297 reverted: only a
    // refusal may withdraw the retry.
    checkIn.mockRejectedValue(FAILED);
    const tree = render();
    await submitManualCode(tree);

    expect(screenText(tree)).toContain(FAILED_SHOWN);
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    expect(manualSubmit(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("clears the refusal when the member comes back to the screen", async () => {
    checkIn.mockRejectedValue(REFUSED);
    const tree = render();
    await submitManualCode(tree);
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();

    act(() => refocus());

    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    expect(manualSubmit(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("re-arms the scanner after a check-in when the member comes back", async () => {
    // The same instance serves the next event, and `success` swaps the
    // scanner for its panel. Without the reset the member would arrive at the
    // next event to "You're checked in" for the previous one, and no camera.
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("You're checked in");
    // The success panel replaces the camera outright.
    expect(tree.root.findAllByType("CameraView" as never)).toHaveLength(0);

    act(() => refocus());

    expect(screenText(tree)).not.toContain("You're checked in");
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => tree.unmount());
  });
});

describe("Check-in on a module-off refusal (#2393)", () => {
  /**
   * `ChapterGuard`'s refusal with `events` off, without its `code`: the
   * message path, which installed builds and an API older than #1020 rely on.
   */
  const MODULE_OFF = {
    statusCode: 403,
    error: "Forbidden",
    message: moduleDisabledMessage("events"),
    requestId: "req_module_off",
  };

  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
  });

  it("says it in the member's terms and switches the scanner and manual submit off", async () => {
    checkIn.mockRejectedValue(MODULE_OFF);
    const tree = render();
    await submitManualCode(tree);

    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.checkIn);
    // The guard's own words tell an officer to go to Settings → Modules.
    expect(screenText(tree)).not.toContain(MODULE_OFF.message);
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();
    expect(manualSubmit(tree).props.disabled).toBe(true);

    act(() => refocus());

    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => tree.unmount());
  });
});

describe("Check-in's title (#2485)", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
  });

  it("is the screen's heading, now that no navigator header names it", () => {
    const tree = render();
    const headings = textHeadings(tree);

    expect(headings.map((node) => node.props.children)).toEqual(["Check in"]);
  });
});

/** A scanned QR for `eventId`, as s22 draws it (`lib/events/check-in-code.ts`). */
const qrFor = (eventId: string) => `frapp-checkin:v1:${eventId}:signed`;

/** The camera reads a code. */
async function scan(tree: ReactTestRenderer, data: string) {
  await act(async () => {
    camera(tree).props.onBarcodeScanned({ data });
  });
}

const router = () => vi.mocked(expoRouter.useRouter)();

describe("Check-in's success moment", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
    vi.mocked(router().navigate).mockClear();
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    successHaptic.mockClear();
    sheetHandle.dismiss.mockClear();
  });

  it("replaces the scanner with a confirmation: the points, the event, and a way back", async () => {
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);

    const text = screenText(tree);
    expect(text).toContain("You're checked in");
    expect(text).toContain("+10 pts");
    expect(text).toContain("Chapter meeting");
    // Nothing of the scanner is left to act on.
    expect(tree.root.findAllByType("CameraView" as never)).toHaveLength(0);
    expect(text).not.toContain("Enter code manually");
    // VoiceOver hears the same sentence the chat event card shows.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "You're checked in. +10 pts",
    );

    // To the event it confirmed, not `back()`: a hidden tab's history lands
    // on Chat home.
    act(() => pressableDrawing(tree, "Back to event").props.onPress());
    expect(router().navigate).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-1" },
    });
    act(() => tree.unmount());
  });

  it("taps once per check-in, not once per render", async () => {
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);
    expect(successHaptic).toHaveBeenCalledTimes(1);

    act(() =>
      tree.update(
        <FrappThemeProvider>
          <CheckInScreen />
        </FrappThemeProvider>,
      ),
    );
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("tells TalkBack through a live region that was there before the check-in", async () => {
    // TalkBack reads a change inside a live region it already knows; a region
    // that mounts with its content isn't reliably read. And announcing as
    // well would say it twice.
    checkIn.mockResolvedValue({});
    const platform = Platform as { OS: string };
    const os = platform.OS;
    platform.OS = "android";
    try {
      const tree = render();
      const region = () =>
        tree.root.find(
          (node) =>
            node.type === ("View" as never) &&
            node.props.accessibilityLiveRegion === "polite",
        );
      // Mounted, and empty, before anything has been sent. And a real view:
      // a View that only lays out is flattened away, live region and all.
      expect(drawnText(region())).toBe("");
      expect(region().props.collapsable).toBe(false);

      await submitManualCode(tree);

      expect(region().props.collapsable).toBe(false);
      expect(
        region().find((node) => node.props.accessible === true).props
          .accessibilityLabel,
      ).toBe("You're checked in. +10 pts Chapter meeting");
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      act(() => tree.unmount());
    } finally {
      platform.OS = os;
    }
  });

  it("closes the manual sheet when a typed code lands", async () => {
    checkIn.mockResolvedValue({});
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("You're checked in");
    expect(sheetHandle.dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("drops a check-in that lands after the screen moved to another event", async () => {
    // The tab instance is reused, so the member can be on the next event's
    // scanner by the time a slow check-in for the last one answers.
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1" }),
    );

    moveTo(tree, OTHER_EVENT.id);
    // A code the member types for the event they are on now.
    act(() => manualInput(tree).props.onChangeText("7XY12"));
    await act(async () => answer.land());

    const text = screenText(tree);
    expect(text).not.toContain("You're checked in");
    expect(text).not.toContain(OTHER_EVENT.name);
    expect(successHaptic).not.toHaveBeenCalled();
    // And the scanner for the event on screen is live again, with what the
    // member typed for it left alone.
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    expect(manualInput(tree).props.value).toBe("7XY12");
    act(() => tree.unmount());
  });

  it("lands a check-in for the event the screen came back to", async () => {
    // Left before it answered, and back: it is this event's, so it still
    // shows as sending and its answer is drawn.
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);

    moveTo(tree, OTHER_EVENT.id);
    moveTo(tree, "evt-1");
    expect(screenText(tree)).toContain("Checking you in");

    await act(async () => answer.land());
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("drops a refusal that lands after the screen moved to another event", async () => {
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);

    moveTo(tree, OTHER_EVENT.id);
    await act(async () => answer.refuse(FAILED));

    expect(screenText(tree)).not.toContain(FAILED_SHOWN);
    expect(
      drawnText(tree.root.findByType("BottomSheetModal" as never)),
    ).not.toContain(FAILED_SHOWN);
    act(() => tree.unmount());
  });

  it("doesn't let a late gate refusal for the last event switch this one's scanner off", async () => {
    // `blocked` disarms the camera and the manual field; for the wrong event
    // it would leave the member a dead scanner at the right one.
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);

    moveTo(tree, OTHER_EVENT.id);
    await act(async () => answer.refuse(REFUSED));

    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => manualInput(tree).props.onChangeText("7XY12"));
    expect(manualSubmit(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("names the event the check-in was sent for, whatever the event becomes after", async () => {
    // The event re-reads while the panel is up: an officer renamed it, or
    // changed its points. The confirmation is of what was sent.
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("Chapter meeting");

    state.useEvent = () => ({
      data: { ...EVENT, name: "Chapter meeting (moved)", point_value: 50 },
    });
    try {
      rerender(tree);
      const text = screenText(tree);
      expect(text).toContain("You're checked in");
      expect(text).toContain("+10 pts");
      expect(text).not.toContain("+50 pts");
      expect(text).not.toContain("(moved)");
    } finally {
      state.useEvent = null;
    }
    act(() => tree.unmount());
  });

  it("puts the last event's confirmation away when the screen moves to another", async () => {
    // A `frapp://` link can move the focused screen, which runs no focus
    // reset: without this, event B would open on A's "You're checked in".
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("You're checked in");

    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).not.toContain("You're checked in");
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => tree.unmount());
  });
});

describe("Check-in keeps each event's state to itself", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
  });

  it("leaves the last event's refusal and typed code behind", async () => {
    checkIn.mockRejectedValue({ statusCode: 409, message: "Conflict" });
    const tree = render();
    await scan(tree, qrFor("evt-1"));
    expect(screenText(tree)).toContain(ALREADY_CHECKED_IN_COPY);
    act(() => manualInput(tree).props.onChangeText("4KQ88"));

    moveTo(tree, OTHER_EVENT.id);

    expect(screenText(tree)).not.toContain(ALREADY_CHECKED_IN_COPY);
    openSheet(tree);
    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).not.toContain(ALREADY_CHECKED_IN_COPY);
    expect(manualInput(tree).props.value).toBe("");
    act(() => tree.unmount());
  });

  it("leaves this event's scanner and Check in on while the last event's check-in is on its way", async () => {
    // A slow venue network: the member left A's scanner, or a link moved it,
    // before A answered. Nothing of A's may switch B off.
    const answers = pendingCheckIns();
    const tree = render();
    await scan(tree, qrFor("evt-1"));
    expect(screenText(tree)).toContain("Checking you in");

    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).not.toContain("Checking you in");
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => manualInput(tree).props.onChangeText("7XY12"));
    expect(manualSubmit(tree).props.disabled).toBe(false);

    await scan(tree, qrFor(OTHER_EVENT.id));
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: OTHER_EVENT.id }),
    );
    expect(screenText(tree)).toContain("Checking you in");

    await act(async () => answers[1].land());
    expect(screenText(tree)).toContain("You're checked in");
    expect(screenText(tree)).toContain(OTHER_EVENT.name);
    act(() => tree.unmount());
  });

  it("keeps this event's check-in sending when the last event's settles, and sends it once", async () => {
    // A was typed, so it never held the scanner. B's scan is on its way when
    // A answers; A's answer must clear neither B's sending nor B's latch.
    const answers = pendingCheckIns();
    const tree = render();
    await submitManualCode(tree);

    moveTo(tree, OTHER_EVENT.id);
    // What the camera holds: it keeps handing over the code in frame.
    const scanB = camera(tree).props.onBarcodeScanned;
    await scan(tree, qrFor(OTHER_EVENT.id));
    expect(checkIn).toHaveBeenCalledTimes(2);

    await act(async () => answers[0].land());
    expect(screenText(tree)).toContain("Checking you in");
    await act(async () => scanB({ data: qrFor(OTHER_EVENT.id) }));

    moveTo(tree, "evt-3");
    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).toContain("Checking you in");
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();
    await act(async () => scanB({ data: qrFor(OTHER_EVENT.id) }));
    expect(checkIn).toHaveBeenCalledTimes(2);

    await act(async () => answers[1].land());
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("leaves nothing sending at an event whose check-in settled while the screen was elsewhere, and sends again there", async () => {
    // Its latch is released wherever the screen was when it answered. Held
    // until the screen came back to it, every scan and typed code at that
    // event would be dropped in silence, under controls that look armed.
    for (const settle of [
      (answer: ReturnType<typeof pendingCheckIn>) => answer.land(),
      (answer: ReturnType<typeof pendingCheckIn>) => answer.refuse(FAILED),
    ]) {
      for (const sendAgain of [
        (tree: ReactTestRenderer) => scan(tree, qrFor("evt-1")),
        (tree: ReactTestRenderer) => submitManualCode(tree),
      ]) {
        checkIn.mockReset();
        const answer = pendingCheckIn();
        const tree = render();
        try {
          await submitManualCode(tree);
          moveTo(tree, OTHER_EVENT.id);
          await act(async () => settle(answer));

          moveTo(tree, "evt-1");
          expect(screenText(tree)).not.toContain("Checking you in");
          expect(camera(tree).props.onBarcodeScanned).toEqual(
            expect.any(Function),
          );
          act(() => manualInput(tree).props.onChangeText("4KQ88"));
          expect(manualSubmit(tree).props.disabled).toBe(false);

          checkIn.mockResolvedValue({});
          await sendAgain(tree);
          expect(checkIn).toHaveBeenCalledTimes(2);
          expect(checkIn).toHaveBeenLastCalledWith(
            expect.objectContaining({ eventId: "evt-1" }),
          );
          expect(screenText(tree)).toContain("You're checked in");
        } finally {
          act(() => tree.unmount());
        }
      }
    }
  });

  it("reports the last event's wrong code again at the next one", async () => {
    const tree = render();
    await scan(tree, qrFor("evt-other"));
    expect(screenText(tree)).toContain("That code is for a different event.");

    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).not.toContain(
      "That code is for a different event.",
    );
    await scan(tree, qrFor("evt-other"));
    expect(screenText(tree)).toContain("That code is for a different event.");
    act(() => tree.unmount());
  });
});

describe("Check-in before its event has loaded", () => {
  const ZONED = {
    ...EVENT,
    check_in_zone: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
    ],
  };
  let loaded: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
    loaded = undefined;
    state.useEvent = () => ({ data: loaded });
  });
  afterEach(() => {
    state.useEvent = null;
  });

  it("sends nothing until it has, and then sends what a zoned event needs", async () => {
    // Whether a location goes with the check-in comes from the event: sent
    // before it loads, a zoned event's check-in would go without one and be
    // refused while the member stands in the zone.
    vi.mocked(requireForegroundFix).mockResolvedValue({ lat: 0.2, lng: 0.5 });
    checkIn.mockResolvedValue({});
    const tree = render();
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();
    act(() => manualInput(tree).props.onChangeText("4KQ88"));
    expect(manualSubmit(tree).props.disabled).toBe(true);
    await act(async () => {
      manualInput(tree).props.onSubmitEditing?.();
    });
    expect(checkIn).not.toHaveBeenCalled();

    loaded = ZONED;
    rerender(tree);
    await scan(tree, qrFor("evt-1"));

    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1", lat: 0.2, lng: 0.5 }),
    );
    // And the panel has the event to name.
    const text = screenText(tree);
    expect(text).toContain("Chapter meeting");
    expect(text).toContain("+10 pts");
    act(() => tree.unmount());
  });

  it("says so, with a way to try again, when the event didn't load", () => {
    const refetch = vi.fn();
    state.useEvent = () => ({
      data: undefined,
      isError: true,
      isFetching: false,
      refetch,
    });
    const tree = render();
    expect(screenText(tree)).toContain("Event didn't load");
    expect(tree.root.findAllByType("CameraView" as never)).toHaveLength(0);
    act(() =>
      tree.root
        .find((node) => node.props.accessibilityLabel === "Try again")
        .props.onPress(),
    );
    expect(refetch).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("Check-in's way out", () => {
  beforeEach(() => {
    vi.mocked(router().navigate).mockClear();
  });

  const close = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityLabel === "Close check-in",
    );

  it("goes to the event's detail, where Scan QR opened it", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    const tree = render();
    act(() => close(tree).props.onPress());
    expect(router().navigate).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-1" },
    });
    expect(router().back).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("goes to Events when there is no event to go back to", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    const tree = render();
    act(() => close(tree).props.onPress());
    expect(router().navigate).toHaveBeenCalledWith("/events");
    act(() => tree.unmount());
  });
});

describe("Check-in's manual code", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
    state.writeBlockedReason = null;
  });

  it("is typed in a sheet field, which rises with the keyboard", () => {
    // A plain `TextInput` at the foot of the screen sat under the keyboard on
    // Android, where the app-wide provider stops the window resizing (#3354).
    const tree = render();
    const input = tree.root.find(
      (node) => node.props.accessibilityLabel === "Manual check-in code",
    );
    expect(input.type).toBe("BottomSheetTextInput");
    expect(tree.root.findAllByType("TextInput" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("switches the decoder off while the sheet is up, and back on when it closes", () => {
    const tree = render();
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));

    act(() => pressableDrawing(tree, "Enter code manually").props.onPress());
    // A scan behind the scrim would send a second check-in under the member.
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();

    act(() =>
      tree.root.findByType("BottomSheetModal" as never).props.onDismiss(),
    );
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => tree.unmount());
  });

  it("shows a failed code in the sheet, where the member is typing", async () => {
    checkIn.mockRejectedValue(FAILED);
    const tree = render();
    await submitManualCode(tree);

    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(FAILED_SHOWN);
    act(() => tree.unmount());
  });

  it("keeps a scan's refusal when the sheet opens: it is still true of a typed code", async () => {
    for (const [refusal, shown] of [
      [
        {
          statusCode: 400,
          error: "Bad Request",
          message: "Location is outside the geofence",
        },
        "You're outside the zone. Move inside it and try again.",
      ],
      // No signing secret here: a typed code is refused the same way.
      [
        {
          statusCode: 503,
          error: "Service Unavailable",
          message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
        },
        FAILED_SHOWN,
      ],
    ] as const) {
      checkIn.mockRejectedValue(refusal);
      const tree = render();
      try {
        await scan(tree, qrFor("evt-1"));
        expect(screenText(tree)).toContain(shown);

        openSheet(tree);
        const sheet = tree.root.findByType("BottomSheetModal" as never);
        expect(drawnText(sheet)).toContain(shown);
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("keeps an already-checked-in answer when the sheet opens", async () => {
    checkIn.mockRejectedValue({ statusCode: 409, message: "Conflict" });
    const tree = render();
    await scan(tree, qrFor("evt-1"));

    openSheet(tree);
    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(ALREADY_CHECKED_IN_COPY);
    act(() => tree.unmount());
  });

  it("clears a refusal of the scanned code itself when the sheet opens", async () => {
    // A stale, screenshotted or malformed QR says nothing about the code the
    // member is about to type off the host's screen, and nor does a request
    // that never got a real answer.
    const TOKEN_TOO_LONG = "token must be shorter than or equal to 256 characters";
    for (const [refusal, shown] of [
      [
        { statusCode: 403, message: CHECK_IN_CODE_REFUSED_MESSAGE },
        "That code is wrong or has expired. Ask the host for the current one.",
      ],
      [{ statusCode: 400, message: [TOKEN_TOO_LONG] }, FAILED_SHOWN],
      [
        new TypeError("Network request failed"),
        "Couldn't reach Frapp. Check your connection and try again.",
      ],
      [{ statusCode: 408, message: "Request Timeout" }, FAILED_SHOWN],
    ] as const) {
      checkIn.mockRejectedValue(refusal);
      const tree = render();
      try {
        await scan(tree, qrFor("evt-1"));
        expect(screenText(tree)).toContain(shown);

        openSheet(tree);
        expect(screenText(tree)).not.toContain(shown);
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("drops the wrong-event line when the sheet opens, and reports that code again after", async () => {
    const tree = render();
    await scan(tree, qrFor("evt-other"));
    expect(screenText(tree)).toContain("That code is for a different event.");

    openSheet(tree);
    expect(screenText(tree)).not.toContain(
      "That code is for a different event.",
    );

    act(() =>
      tree.root.findByType("BottomSheetModal" as never).props.onDismiss(),
    );
    // The same wrong code, held up again once the sheet is gone.
    await scan(tree, qrFor("evt-other"));
    expect(screenText(tree)).toContain("That code is for a different event.");
    expect(checkIn).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  describe("the keyboard's Go key", () => {
    /** The member presses Go with the code typed so far. */
    async function pressGo(tree: ReactTestRenderer) {
      await act(async () => {
        manualInput(tree).props.onSubmitEditing?.();
      });
    }

    it("sends a plausible code", async () => {
      checkIn.mockResolvedValue({});
      const tree = render();
      act(() => manualInput(tree).props.onChangeText("4KQ88"));
      await pressGo(tree);
      expect(checkIn).toHaveBeenCalledTimes(1);
      act(() => tree.unmount());
    });

    it("sends nothing for a code that can't be one", async () => {
      const tree = render();
      act(() => manualInput(tree).props.onChangeText("4KQ"));
      await pressGo(tree);
      expect(checkIn).not.toHaveBeenCalled();
      act(() => tree.unmount());
    });

    it("sends nothing while offline", async () => {
      // Check-in has no outbox, so a send with no network is lost.
      state.writeBlockedReason = "Reconnect to make changes";
      const tree = render();
      act(() => manualInput(tree).props.onChangeText("4KQ88"));
      await pressGo(tree);
      expect(checkIn).not.toHaveBeenCalled();
      act(() => tree.unmount());
    });

    it("sends one check-in for a double tap", async () => {
      // Both presses land before the re-render that disables the button.
      checkIn.mockReturnValue(new Promise(() => undefined));
      const tree = render();
      act(() => manualInput(tree).props.onChangeText("4KQ88"));
      const press = manualSubmit(tree).props.onPress;
      await act(async () => {
        press();
        press();
      });
      expect(checkIn).toHaveBeenCalledTimes(1);
      act(() => tree.unmount());
    });

    it("sends nothing while a check-in is already on its way", async () => {
      checkIn.mockReturnValue(new Promise(() => undefined));
      const tree = render();
      await submitManualCode(tree);
      expect(checkIn).toHaveBeenCalledTimes(1);

      await pressGo(tree);
      expect(checkIn).toHaveBeenCalledTimes(1);
      act(() => tree.unmount());
    });
  });
});

describe("Check-in after a failed attempt", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
  });

  it("sends the same event's next scan, and its next typed code", async () => {
    // The latch is released when the check-in fails as well as when it
    // lands. Left held, the scanner would look armed and drop every code.
    for (const attempt of [
      (tree: ReactTestRenderer) => scan(tree, qrFor("evt-1")),
      (tree: ReactTestRenderer) => submitManualCode(tree),
    ]) {
      checkIn.mockReset();
      checkIn.mockRejectedValueOnce(FAILED).mockResolvedValue({});
      const tree = render();
      try {
        await attempt(tree);
        expect(screenText(tree)).toContain(FAILED_SHOWN);

        await attempt(tree);
        expect(checkIn).toHaveBeenCalledTimes(2);
        expect(screenText(tree)).toContain("You're checked in");
      } finally {
        act(() => tree.unmount());
      }
    }
  });
});

/**
 * What the real `useCheckIn` makes of a response the API never shaped. An
 * edge's empty-bodied 5xx (during a deploy, say) is `error: undefined` or
 * `""` to openapi-fetch 0.17, so a hook that trusted `error` would resolve,
 * and the screen would confirm a check-in nothing wrote. Check-in has no
 * outbox: the member would leave believing they were on the roster.
 */
describe("Check-in on an empty-bodied 5xx", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    successHaptic.mockClear();
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    state.realCheckIn = true;
  });
  afterEach(() => {
    state.realCheckIn = false;
  });

  it("says the check-in didn't go through, and leaves the scanner armed to try again", async () => {
    for (const error of [undefined, ""] as const) {
      const post = vi.fn(async () => ({
        data: undefined,
        error,
        response: new Response(null, { status: 502 }),
      }));
      const tree = renderWithClient({ POST: post });
      try {
        await scan(tree, qrFor("evt-1"));
        expect(post).toHaveBeenCalledTimes(1);

        const text = screenText(tree);
        expect(text).not.toContain("You're checked in");
        expect(text).toContain("Couldn't check you in.");
        expect(successHaptic).not.toHaveBeenCalled();
        expect(
          AccessibilityInfo.announceForAccessibility,
        ).not.toHaveBeenCalled();
        expect(camera(tree).props.onBarcodeScanned).toEqual(
          expect.any(Function),
        );
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("confirms a check-in the API answered with a 2xx", async () => {
    // The same path, so the spec above fails for the right reason.
    const post = vi.fn(async () => ({
      data: {},
      error: undefined,
      response: new Response(null, { status: 201 }),
    }));
    const tree = renderWithClient({ POST: post });
    try {
      await scan(tree, qrFor("evt-1"));
      expect(screenText(tree)).toContain("You're checked in");
    } finally {
      act(() => tree.unmount());
    }
  });
});

describe("Check-in's scanner while offline", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    checkIn.mockReset();
  });
  afterEach(() => {
    state.writeBlockedReason = null;
  });

  it("sends nothing for a scan, and scans again once the member reconnects", async () => {
    // Check-in has no outbox. And a scan that claimed the latch with nothing
    // sent would hold it for good, so every scan after reconnecting would be
    // dropped.
    checkIn.mockResolvedValue({});
    state.writeBlockedReason = "Reconnect to make changes";
    const tree = render();
    await scan(tree, qrFor("evt-1"));
    expect(checkIn).not.toHaveBeenCalled();

    state.writeBlockedReason = null;
    rerender(tree);
    await scan(tree, qrFor("evt-1"));
    expect(checkIn).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("Check-in's camera and torch", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
  });

  const torch = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Flashlight" &&
        node.type === ("Pressable" as never),
    );

  it("turns the torch on and off", () => {
    const tree = render();
    expect(camera(tree).props.enableTorch).toBe(false);

    act(() => torch(tree).props.onPress());
    expect(camera(tree).props.enableTorch).toBe(true);
    expect(torch(tree).props.accessibilityState).toEqual({ checked: true });

    act(() => torch(tree).props.onPress());
    expect(camera(tree).props.enableTorch).toBe(false);
    act(() => tree.unmount());
  });

  it("lets the camera, and the torch, go when the member leaves", () => {
    // The tab screen stays mounted after the member leaves; a camera left
    // mounted would keep running, torch and all, behind the next screen.
    const tree = render();
    act(() => torch(tree).props.onPress());
    expect(camera(tree).props.enableTorch).toBe(true);

    act(() => blur());
    expect(tree.root.findAllByType("CameraView" as never)).toHaveLength(0);

    act(() => refocus());
    expect(camera(tree).props.enableTorch).toBe(false);
    act(() => tree.unmount());
  });

  it("closes the manual sheet when the member leaves", () => {
    // It is portalled above the navigator, so it would float over the event.
    sheetHandle.dismiss.mockClear();
    const tree = render();
    openSheet(tree);

    act(() => blur());
    expect(sheetHandle.dismiss).toHaveBeenCalledTimes(1);

    act(() => refocus());
    act(() => tree.unmount());
  });
});
