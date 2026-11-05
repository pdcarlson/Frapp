/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AccessibilityInfo, Platform } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText, textHeadings } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";

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
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEvent: (id: string) => ({
    data: id === OTHER_EVENT.id ? OTHER_EVENT : EVENT,
  }),
  useCheckIn: () => ({ mutateAsync: checkIn, isPending: false }),
}));

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

    expect(screenText(tree)).toContain(FAILED.message);
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

  it("leaves Android's announcement to the panel's live region", async () => {
    // TalkBack reads `accessibilityLiveRegion` itself; announcing as well
    // would say it twice.
    checkIn.mockResolvedValue({});
    const platform = Platform as { OS: string };
    const os = platform.OS;
    platform.OS = "android";
    try {
      const tree = render();
      await submitManualCode(tree);
      expect(screenText(tree)).toContain("You're checked in");
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
    let land!: () => void;
    checkIn.mockReturnValue(
      new Promise<void>((resolve) => {
        land = resolve;
      }),
    );
    const tree = render();
    await submitManualCode(tree);
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1" }),
    );

    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: OTHER_EVENT.id,
    });
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <CheckInScreen />
        </FrappThemeProvider>,
      ),
    );
    await act(async () => land());

    const text = screenText(tree);
    expect(text).not.toContain("You're checked in");
    expect(text).not.toContain(OTHER_EVENT.name);
    expect(successHaptic).not.toHaveBeenCalled();
    // And the scanner for the event on screen is live again.
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
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
    expect(drawnText(sheet)).toContain(FAILED.message);
    act(() => tree.unmount());
  });

  it("keeps a scan's refusal when the sheet opens: it is still true of a typed code", async () => {
    const OUTSIDE = {
      statusCode: 400,
      error: "Bad Request",
      message: "You're outside the check-in zone.",
    };
    checkIn.mockRejectedValue(OUTSIDE);
    const tree = render();
    await scan(tree, qrFor("evt-1"));
    expect(screenText(tree)).toContain(OUTSIDE.message);

    openSheet(tree);
    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(OUTSIDE.message);
    act(() => tree.unmount());
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
