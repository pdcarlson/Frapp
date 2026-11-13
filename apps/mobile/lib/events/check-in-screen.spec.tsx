/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AccessibilityInfo, Linking, Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappThemeProvider } from "@/lib/theme";
import { stackScreen } from "@/test/stack-screen";
import { drawnText, screenText, textHeadings } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import { FrappClientProvider } from "@repo/hooks";
import {
  ALREADY_CHECKED_IN_COPY,
  ALREADY_CHECKED_IN_TITLE,
  CHECK_IN_CODE_REFUSED_MESSAGE,
  CHECK_IN_NEEDS_LOCATION_MESSAGES,
} from "@/lib/events/check-in-outcome";
import {
  getCheckInLocation,
  type CheckInLocation,
} from "@/lib/events/check-in-location";

/**
 * s18, rendered (#2416), as the phone's camera opens it (2026-11-13).
 *
 * The event's QR is an https link (`…/check-in?event=<id>&t=<token>`) the
 * phone's own camera reads; tapping its banner opens this screen with the
 * event and the token, and the check-in goes on its own once the event has
 * loaded and the phone is online. Opened from the app with no token, the
 * screen says to use the camera and offers the typed code.
 *
 * Location is asked for in context (`lib/events/check-in-location.ts`, mocked
 * here so each spec says what the phone gives): a zoned event with no
 * location sends nothing and says what to change; an unzoned one sends
 * without coordinates, and says what to change only when the server answers
 * that it needed them.
 *
 * It renders `app/(app)/check-in.tsx` but lives here: a spec under `app/`
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

/** Any failure that is not a gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Check-in service is unavailable.",
  requestId: "req_failed",
};
/** What a member reads for {@link FAILED}: never the server's own text. */
const FAILED_SHOWN = "Couldn't check you in.";

/** The server's refusal of a check-in that carried no location. */
const NEEDS_LOCATION = {
  statusCode: 400,
  error: "Bad Request",
  message: CHECK_IN_NEEDS_LOCATION_MESSAGES[0],
};

/** A geofence refusal: a 400 that is not about a missing location. */
const OUTSIDE_ZONE = {
  statusCode: 400,
  error: "Bad Request",
  message: "Location is outside the geofence",
};
const OUTSIDE_ZONE_SHOWN =
  "You're outside the zone. Move inside it and try again.";

/** The shared copy for a refused typed code. */
const TYPED_CODE_REFUSED_SHOWN =
  "That code is wrong or has expired. Ask the host for the current one.";

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

/** The same event with a drawn zone: no check-in goes without a location. */
const ZONED = {
  ...EVENT,
  check_in_zone: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
  ],
};

/** The event a second link can move the screen to in place. */
const OTHER_EVENT = { ...EVENT, id: "evt-2", name: "Formal", point_value: 5 };

/** The phone's position, when it gives one. */
const FIX = { lat: 42.73, lng: -73.68, accuracy_meters: 12 };

const checkIn = vi.fn();

const state = vi.hoisted(() => ({
  writeBlockedReason: null as string | null,
  successHaptic: vi.fn(),
  /** Stands in for `useEvent` when set; reset by the specs that set it. */
  useEvent: null as null | ((id: string) => Record<string, unknown>),
  /**
   * The real `useCheckIn`, on the client `renderWithClient` provides, for a
   * spec that has to see what the hook makes of a response. Set for the life
   * of one tree.
   */
  realCheckIn: false,
  /** The fix `useWarmCheckInFix` has ready, if any. */
  warmFix: null as null | {
    lat: number;
    lng: number;
    accuracy_meters?: number;
  },
  /**
   * What the member's own row reads as when s18 asks on a 409
   * (`useMyAttendance(...).refetch()`): a check-in by default.
   */
  ownRow: {
    isSuccess: true,
    data: {
      attendance: {
        status: "PRESENT",
        check_in_time: "2026-11-07T00:52:00.000Z",
      },
    },
  } as { isSuccess: boolean; data?: unknown },
  openSettings: vi.fn(async () => undefined),
  enableNetworkProvider: vi.fn(async () => undefined),
  /** Every `AppState` "change" listener the screen has registered. */
  appStateListeners: new Set<(next: string) => void>(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    ...actual,
    useEvent: (id: string) =>
      state.useEvent
        ? state.useEvent(id)
        : { data: id === OTHER_EVENT.id ? OTHER_EVENT : EVENT },
    useMyAttendance: () => ({ refetch: async () => state.ownRow }),
    useCheckIn: () =>
      state.realCheckIn
        ? actual.useCheckIn()
        : {
            mutateAsync: (variables: unknown) =>
              Promise.resolve(checkIn(variables)),
          },
  };
});

vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return {
    ...reactNativeStub,
    Linking: { openSettings: state.openSettings },
    AppState: {
      ...reactNativeStub.AppState,
      addEventListener: (_type: string, listener: (next: string) => void) => {
        state.appStateListeners.add(listener);
        return { remove: () => state.appStateListeners.delete(listener) };
      },
    },
  };
});

vi.mock("expo-location", () => ({
  enableNetworkProviderAsync: () => state.enableNetworkProvider(),
  hasServicesEnabledAsync: vi.fn(async () => true),
  getForegroundPermissionsAsync: vi.fn(async () => ({
    granted: false,
    canAskAgain: true,
  })),
  requestForegroundPermissionsAsync: vi.fn(async () => ({
    granted: false,
    canAskAgain: true,
  })),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(async () => null),
  Accuracy: { Balanced: 3, High: 4 },
}));

// What the phone gives is each spec's to say; the copy for each blocker is
// the real one.
vi.mock("@/lib/events/check-in-location", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/events/check-in-location")>();
  return { ...actual, getCheckInLocation: vi.fn() };
});

vi.mock("@/lib/events/check-in-fix", () => ({
  useWarmCheckInFix: () => () => state.warmFix,
}));

vi.mock("@/lib/haptics", () => ({
  successHaptic: () => state.successHaptic(),
}));
const { successHaptic } = state;

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import CheckInScreen, { CODE_CHANGED_COPY } from "@/app/(app)/check-in";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;
/** "The member left this screen": the other half of `__refocus`. */
const blur = (expoRouter as unknown as { __blur: () => void }).__blur;

const locate = vi.mocked(getCheckInLocation);

/** The phone gives a position. */
const located = (): CheckInLocation => ({ kind: "fix", fix: { ...FIX } });

beforeEach(() => {
  checkIn.mockReset();
  checkIn.mockResolvedValue({});
  locate.mockReset();
  locate.mockImplementation(async () => located());
  state.warmFix = null;
  state.useEvent = null;
  state.writeBlockedReason = null;
  state.openSettings.mockClear();
  state.enableNetworkProvider.mockReset();
  state.enableNetworkProvider.mockResolvedValue(undefined);
  successHaptic.mockClear();
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
});

/**
 * What the screen's `sheetRef` holds. The bottom-sheet mock is a host string,
 * whose ref react-test-renderer leaves null unless a node mock stands in, and
 * with a null ref `useSheetVisit`'s dismiss does nothing, so a spec could not
 * tell a dismiss from none.
 */
const sheetHandle = { present: vi.fn(), dismiss: vi.fn() };

/** The screen opened by the camera's link for `eventId`. */
function openedByLink(eventId = "evt-1", token = "tok-1") {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
    event: eventId,
    t: token,
  });
}

/** The screen opened from the app's own button, with no token. */
function openedFromApp(eventId = "evt-1") {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ eventId });
}

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

/** Lets every check-in on its way find its location and get its answer. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

/** A second link, or the app, hands the mounted screen another event. */
function moveTo(tree: ReactTestRenderer, eventId: string, token?: string) {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue(
    token ? { event: eventId, t: token } : { eventId },
  );
  rerender(tree);
}

/** The phone comes back to the foreground (or leaves it). */
async function appState(next: "active" | "background") {
  await act(async () => {
    for (const listener of [...state.appStateListeners]) listener(next);
  });
  await settle();
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

/** A control found by what it draws. */
const pressableDrawing = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) => node.type === ("Pressable" as never) && drawnText(node) === label,
  );

/** Every control drawing `label`, for a check that there is none. */
const pressablesDrawing = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => node.type === ("Pressable" as never) && drawnText(node) === label,
  );

/** Opens the manual sheet the way the member does, and lets it finish rising. */
function openSheet(tree: ReactTestRenderer) {
  act(() => pressableDrawing(tree, "Enter code instead").props.onPress());
  act(() =>
    tree.root.findByType("BottomSheetModal" as never).props.onAnimate(-1, 0),
  );
}

/** The manual sheet's "Check in" button (`SheetPrimaryButton`). */
const manualSubmit = (tree: ReactTestRenderer) =>
  tree.root
    .findByType("BottomSheetModal" as never)
    .find(
      (node) =>
        node.type === ("Pressable" as never) && drawnText(node) === "Check in",
    );

/** Types a plausible code and submits it, settling the async submit. */
async function submitManualCode(tree: ReactTestRenderer, code = "4KQ88") {
  act(() => manualInput(tree).props.onChangeText(code));
  await act(async () => {
    manualSubmit(tree).props.onPress();
  });
  await settle();
}

/** Presses a control by what it draws, and settles what it started. */
async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    pressableDrawing(tree, label).props.onPress();
  });
  await settle();
}

const router = () => vi.mocked(expoRouter.useRouter)();

/** Runs `body` with `Platform.OS` set, putting it back after. */
async function onPlatform(os: "ios" | "android", body: () => Promise<void>) {
  const platform = Platform as { OS: string };
  const was = platform.OS;
  platform.OS = os;
  try {
    await body();
  } finally {
    platform.OS = was;
  }
}

describe("Check-in from the camera's link", () => {
  beforeEach(() => openedByLink());

  it("sends the token and the phone's position once the event has loaded, and only once", async () => {
    const tree = render();
    await settle();

    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "evt-1",
      token: "tok-1",
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 12,
    });
    expect(screenText(tree)).toContain("You're checked in");

    // Re-renders, and a trip away and back, never send the same scan twice.
    rerender(tree);
    rerender(tree);
    act(() => blur());
    act(() => refocus());
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("sends nothing before the event has loaded, and sends once it has", async () => {
    // Whether a location must go with it comes from the event's zone.
    let loaded: Record<string, unknown> | undefined = undefined;
    state.useEvent = () => ({ data: loaded });
    const tree = render();
    await settle();

    expect(locate).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Checking you in…");

    loaded = EVENT;
    rerender(tree);
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1", token: "tok-1" }),
    );
    act(() => tree.unmount());
  });

  it("sends nothing while offline, says why, and sends once the phone reconnects", async () => {
    // Check-in has no outbox: a check-in sent with no network is lost.
    state.writeBlockedReason = "Reconnect to make changes";
    const tree = render();
    await settle();

    expect(checkIn).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Reconnect to make changes");

    state.writeBlockedReason = null;
    rerender(tree);
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("uses the fix kept ready while the screen was up", async () => {
    state.warmFix = { lat: 42.731, lng: -73.679, accuracy_meters: 9 };
    const tree = render();
    await settle();

    expect(locate).toHaveBeenCalledWith(state.warmFix);
    act(() => tree.unmount());
  });

  it("reads the first of a repeated parameter, as expo-router hands it over", async () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      event: ["evt-1", "evt-9"],
      t: ["tok-1", "tok-9"],
    });
    const tree = render();
    await settle();

    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1", token: "tok-1" }),
    );
    act(() => tree.unmount());
  });

  it("sends a new scan of the same event: a new token is a new check-in", async () => {
    checkIn.mockRejectedValueOnce(FAILED).mockResolvedValue({});
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain(FAILED_SHOWN);

    moveTo(tree, "evt-1", "tok-2");
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: "evt-1", token: "tok-2" }),
    );
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("sends a new scan that arrives while the last one is still under way, once it settles", async () => {
    const answers = pendingCheckIns();
    const tree = render();
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(1);

    moveTo(tree, "evt-1", "tok-2");
    await settle();
    // Not dropped by the latch: it waits.
    expect(checkIn).toHaveBeenCalledTimes(1);

    await act(async () => answers[0]!.refuse(FAILED));
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: "evt-1", token: "tok-2" }),
    );
    act(() => tree.unmount());
  });

  it("names the event while it checks in, with no camera instruction", async () => {
    pendingCheckIn();
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("Chapter meeting");
    expect(text).toContain("Checking you in…");
    expect(text).not.toContain("Point your camera at the code");
    act(() => tree.unmount());
  });
});

describe("Check-in opened from the app, with no token", () => {
  beforeEach(() => openedFromApp());

  it("says to use the camera, and sends nothing on its own", async () => {
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("Point your camera at the code");
    expect(text).toContain("tap the Frapp link that appears");
    expect(pressablesDrawing(tree, "Enter code instead")).toHaveLength(1);
    expect(locate).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("sends a typed code from the sheet, with the phone's position", async () => {
    const tree = render();
    openSheet(tree);
    expect(sheetHandle.present).toHaveBeenCalled();

    await submitManualCode(tree);
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "evt-1",
      manualCode: "4KQ88",
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 12,
    });
    act(() => tree.unmount());
  });

  it("says to use the camera when it has no event at all", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    const tree = render();
    expect(screenText(tree)).toContain(
      "Point your phone's camera at the check-in code to check in.",
    );
    expect(tree.root.findAllByType("BottomSheetModal" as never)).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });

  it("keeps a typed code's submit off until the event has loaded", async () => {
    state.useEvent = () => ({ data: undefined });
    const tree = render();
    act(() => manualInput(tree).props.onChangeText("4KQ88"));
    expect(manualSubmit(tree).props.disabled).toBe(true);
    expect(manualInput(tree).props.onSubmitEditing).toBeUndefined();
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
    act(() =>
      tree.root
        .find((node) => node.props.accessibilityLabel === "Try again")
        .props.onPress(),
    );
    expect(refetch).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("Check-in at a zoned event with no location", () => {
  beforeEach(() => {
    openedByLink();
    state.useEvent = () => ({ data: ZONED });
  });

  it("asks for location from Settings when it was refused for good, and sends nothing", async () => {
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("Allow location for Frapp");
    expect(text).toContain("You must be at the event location.");
    expect(checkIn).not.toHaveBeenCalled();
    expect(pressablesDrawing(tree, "Enter code instead")).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("opens Settings, and checks in when the member comes back", async () => {
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    const tree = render();
    await settle();

    // Coming back to the app before Settings was opened sends nothing.
    await appState("active");
    expect(locate).toHaveBeenCalledTimes(1);

    await press(tree, "Open Settings");
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(checkIn).not.toHaveBeenCalled();

    // Leaving for Settings is not coming back.
    await appState("background");
    expect(locate).toHaveBeenCalledTimes(1);

    locate.mockImplementation(async () => located());
    await appState("active");
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      eventId: "evt-1",
      token: "tok-1",
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 12,
    });
    expect(screenText(tree)).toContain("You're checked in");

    // Once only: the next return to the app sends nothing more.
    await appState("active");
    expect(checkIn).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("closes the typed code's sheet so what to change shows", async () => {
    openedFromApp();
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    sheetHandle.dismiss.mockClear();
    const tree = render();
    openSheet(tree);

    await submitManualCode(tree);
    expect(checkIn).not.toHaveBeenCalled();
    expect(sheetHandle.dismiss).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain("Allow location for Frapp");
    act(() => tree.unmount());
  });

  it("names the zone the member has to be in", async () => {
    state.useEvent = () => ({
      data: { ...ZONED, check_in_zone_name: "Chapter house" },
    });
    locate.mockResolvedValue({ kind: "none", blocker: "no_fix" });
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("Couldn't find your location");
    expect(text).toContain("You must be inside the Chapter house zone.");
    act(() => tree.unmount());
  });

  it("asks again in place when the member said no this time", async () => {
    locate.mockResolvedValueOnce({ kind: "none", blocker: "declined" });
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain("Allow location to check in");

    await press(tree, "Allow location");
    expect(Linking.openSettings).not.toHaveBeenCalled();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok-1", lat: 42.73 }),
    );
    act(() => tree.unmount());
  });

  it("offers Settings on iOS when Location Services are off", async () => {
    await onPlatform("ios", async () => {
      locate.mockResolvedValue({ kind: "none", blocker: "services_off" });
      const tree = render();
      await settle();
      expect(screenText(tree)).toContain("Location is off");

      await press(tree, "Open Settings");
      expect(Linking.openSettings).toHaveBeenCalledTimes(1);
      expect(state.enableNetworkProvider).not.toHaveBeenCalled();
      act(() => tree.unmount());
    });
  });

  it("asks Android to turn location on, and checks in when the member accepts", async () => {
    await onPlatform("android", async () => {
      locate.mockResolvedValueOnce({ kind: "none", blocker: "services_off" });
      const tree = render();
      await settle();
      expect(screenText(tree)).toContain("Turn on location");
      expect(checkIn).not.toHaveBeenCalled();

      await press(tree, "Turn on location");
      expect(state.enableNetworkProvider).toHaveBeenCalledTimes(1);
      expect(Linking.openSettings).not.toHaveBeenCalled();
      expect(checkIn).toHaveBeenCalledTimes(1);
      expect(checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ token: "tok-1", lat: 42.73, lng: -73.68 }),
      );
      expect(screenText(tree)).toContain("You're checked in");
      act(() => tree.unmount());
    });
  });

  it("stays put on Android when the member turns the dialog down", async () => {
    await onPlatform("android", async () => {
      locate.mockResolvedValue({ kind: "none", blocker: "services_off" });
      state.enableNetworkProvider.mockRejectedValue(new Error("declined"));
      const tree = render();
      await settle();

      await press(tree, "Turn on location");
      expect(state.enableNetworkProvider).toHaveBeenCalledTimes(1);
      expect(locate).toHaveBeenCalledTimes(1);
      expect(screenText(tree)).toContain("Turn on location");
      act(() => tree.unmount());
    });
  });
});

describe("Check-in at an unzoned event with no location", () => {
  beforeEach(() => {
    openedByLink();
    locate.mockResolvedValue({ kind: "none", blocker: "no_fix" });
  });

  it("sends without coordinates: only the server knows whether it needed them", async () => {
    const tree = render();
    await settle();

    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1", token: "tok-1" });
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("says what to change, not the server's refusal, when the server needed a location", async () => {
    for (const message of CHECK_IN_NEEDS_LOCATION_MESSAGES) {
      checkIn.mockReset();
      checkIn.mockRejectedValueOnce({ ...NEEDS_LOCATION, message });
      locate.mockReset();
      locate.mockResolvedValueOnce({ kind: "none", blocker: "no_fix" });
      locate.mockImplementation(async () => located());
      const tree = render();
      try {
        await settle();
        const text = screenText(tree);
        expect(text).toContain("Couldn't find your location");
        expect(text).not.toContain(message);

        checkIn.mockResolvedValue({});
        await press(tree, "Try again");
        expect(checkIn).toHaveBeenCalledTimes(2);
        expect(checkIn).toHaveBeenLastCalledWith(
          expect.objectContaining({ token: "tok-1", lat: 42.73 }),
        );
        expect(screenText(tree)).toContain("You're checked in");
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("offers Settings when the needed location was refused for good", async () => {
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    checkIn.mockRejectedValue(NEEDS_LOCATION);
    const tree = render();
    await settle();

    expect(screenText(tree)).toContain("Allow location for Frapp");
    await press(tree, "Open Settings");
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("shows any other 400 as the error line", async () => {
    checkIn.mockRejectedValue(OUTSIDE_ZONE);
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain(OUTSIDE_ZONE_SHOWN);
    expect(text).not.toContain("Couldn't find your location");
    expect(pressablesDrawing(tree, "Try again")).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("relays a needs-location refusal as a line when the phone did send a position", async () => {
    // The location state is for a phone that gave none; one that gave a
    // position has nothing in Settings to change.
    locate.mockImplementation(async () => located());
    checkIn.mockRejectedValue(NEEDS_LOCATION);
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("This check-in needs your location.");
    expect(text).not.toContain("Couldn't find your location");
    expect(pressablesDrawing(tree, "Try again")).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe("Check-in's refused code", () => {
  it("says a scanned code changed, and to point the camera again", async () => {
    openedByLink();
    checkIn.mockRejectedValue({
      statusCode: 403,
      message: CHECK_IN_CODE_REFUSED_MESSAGE,
    });
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain(CODE_CHANGED_COPY);
    expect(text).not.toContain(TYPED_CODE_REFUSED_SHOWN);

    // It is about that scan, so it says nothing about a code typed next.
    openSheet(tree);
    expect(screenText(tree)).not.toContain(CODE_CHANGED_COPY);
    act(() => tree.unmount());
  });

  it("tells a typed code to ask the host for the current one", async () => {
    openedFromApp();
    checkIn.mockRejectedValue({
      statusCode: 403,
      message: CHECK_IN_CODE_REFUSED_MESSAGE,
    });
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);

    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(TYPED_CODE_REFUSED_SHOWN);
    expect(screenText(tree)).not.toContain(CODE_CHANGED_COPY);
    act(() => tree.unmount());
  });
});

describe("Check-in's success moment", () => {
  beforeEach(() => {
    openedByLink();
    vi.mocked(router().dismissTo).mockClear();
    sheetHandle.dismiss.mockClear();
  });

  it("shows the points, the event, and a way back", async () => {
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("You're checked in");
    expect(text).toContain("+10 pts");
    expect(text).toContain("Chapter meeting");
    expect(pressablesDrawing(tree, "Enter code instead")).toHaveLength(0);
    // VoiceOver hears the same sentence the chat event card shows.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "You're checked in. +10 pts",
    );

    // Nothing is under the screen in this spec (no stack), so it opens the
    // event it confirmed; over the event's detail it pops instead.
    act(() => pressableDrawing(tree, "Back to event").props.onPress());
    expect(router().dismissTo).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-1" },
    });
    act(() => tree.unmount());
  });

  it("taps once per check-in, not once per render", async () => {
    const tree = render();
    await settle();
    expect(successHaptic).toHaveBeenCalledTimes(1);

    rerender(tree);
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("tells TalkBack through a live region that was there before the check-in", async () => {
    // TalkBack reads a change inside a live region it already knows; a region
    // that mounts with its content isn't reliably read. And announcing as
    // well would say it twice.
    openedFromApp();
    await onPlatform("android", async () => {
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
    });
  });

  it("closes the manual sheet when a typed code lands", async () => {
    openedFromApp();
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("You're checked in");
    expect(sheetHandle.dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("names the event the check-in was sent for, whatever the event becomes after", async () => {
    // The event re-reads while the panel is up: an officer renamed it, or
    // changed its points. The confirmation is of what was sent.
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain("Chapter meeting");

    state.useEvent = () => ({
      data: { ...EVENT, name: "Chapter meeting (moved)", point_value: 50 },
    });
    rerender(tree);
    const text = screenText(tree);
    expect(text).toContain("You're checked in");
    expect(text).toContain("+10 pts");
    expect(text).not.toContain("+50 pts");
    expect(text).not.toContain("(moved)");
    act(() => tree.unmount());
  });
});

// #3703: a repeat check-in is the member already on the list, which is what
// they came for, so it is the success panel in its own words, with no points
// (none were awarded this time), not an error.
describe("Check-in over a row the member already has (409)", () => {
  const saved = state.ownRow;
  beforeEach(() => {
    openedByLink();
    checkIn.mockRejectedValue({ statusCode: 409, message: "Conflict" });
  });
  afterEach(() => {
    state.ownRow = saved;
  });

  it("reads a PRESENT row as you're in, on the success panel", async () => {
    state.ownRow = {
      isSuccess: true,
      data: { attendance: { status: "PRESENT", check_in_time: null } },
    };
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain(ALREADY_CHECKED_IN_TITLE);
    expect(text).toContain("Back to event");
    expect(text).not.toMatch(/\+\d+ pts/);
    act(() => tree.unmount());
  });

  it("says an officer's ABSENT mark, not you're in", async () => {
    state.ownRow = {
      isSuccess: true,
      data: { attendance: { status: "ABSENT", check_in_time: null } },
    };
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("An officer marked you absent for this event.");
    expect(text).not.toContain(ALREADY_CHECKED_IN_TITLE);
    act(() => tree.unmount());
  });

  it("claims nothing about the row when reading it fails", async () => {
    state.ownRow = { isSuccess: false };
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain(ALREADY_CHECKED_IN_COPY);
    expect(text).not.toContain(ALREADY_CHECKED_IN_TITLE);
    act(() => tree.unmount());
  });
});

describe("Check-in on a gate's refusal (#2297, #2393)", () => {
  beforeEach(() => openedFromApp());

  it.each([
    ["subscription", REFUSED, SUBSCRIPTION_REFUSAL_COPY.checkIn],
    ["module", MODULE_OFF, MODULE_REFUSAL_COPY.checkIn],
  ] as const)(
    "explains a %s refusal in the member's terms and switches the typed code's submit off",
    async (_gate, refusal, shown) => {
      checkIn.mockRejectedValue(refusal);
      const tree = render();
      openSheet(tree);
      await submitManualCode(tree);

      expect(screenText(tree)).toContain(shown);
      // The server's own words are a purchase instruction, which the store
      // declaration forbids inside the app, or point an officer to Settings.
      expect(screenText(tree)).not.toContain(refusal.message);
      act(() => manualInput(tree).props.onChangeText("7XY12"));
      expect(manualSubmit(tree).props.disabled).toBe(true);
      act(() => tree.unmount());
    },
  );

  it("shows a scanned link's refusal the same way", async () => {
    openedByLink();
    checkIn.mockRejectedValue(REFUSED);
    const tree = render();
    await settle();

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
    expect(screenText(tree)).not.toContain(REFUSED.message);
    act(() => manualInput(tree).props.onChangeText("7XY12"));
    expect(manualSubmit(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps the typed code's submit on after an ordinary failure", async () => {
    // Only a gate refusal may withdraw the retry.
    checkIn.mockRejectedValue(FAILED);
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);

    expect(screenText(tree)).toContain(FAILED_SHOWN);
    expect(manualSubmit(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

describe("Check-in keeps each event's state to itself", () => {
  beforeEach(() => {
    vi.mocked(router().dismissTo).mockClear();
  });

  it("drops a check-in that lands after the screen moved to another event", async () => {
    // A second link opened over this one hands the screen a new event in
    // place, while the first check-in is still on its way.
    openedFromApp();
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);
    expect(checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1" }),
    );

    moveTo(tree, OTHER_EVENT.id);
    // The new event starts clean: no typed code, nothing sending.
    expect(manualInput(tree).props.value).toBe("");
    expect(screenText(tree)).not.toContain("Checking you in");
    // A code the member types for the event they are on now.
    act(() => manualInput(tree).props.onChangeText("7XY12"));
    await act(async () => answer.land());
    await settle();

    const text = screenText(tree);
    expect(text).not.toContain("You're checked in");
    expect(text).not.toContain(EVENT.name);
    expect(successHaptic).not.toHaveBeenCalled();
    expect(manualInput(tree).props.value).toBe("7XY12");
    expect(manualSubmit(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("drops a refusal, gate or not, that lands after the screen moved", async () => {
    for (const refusal of [FAILED, REFUSED]) {
      openedFromApp();
      checkIn.mockReset();
      const answer = pendingCheckIn();
      const tree = render();
      try {
        await submitManualCode(tree);
        moveTo(tree, OTHER_EVENT.id);
        await act(async () => answer.refuse(refusal));
        await settle();

        const text = screenText(tree);
        expect(text).not.toContain(FAILED_SHOWN);
        expect(text).not.toContain(SUBSCRIPTION_REFUSAL_COPY.checkIn);
        act(() => manualInput(tree).props.onChangeText("7XY12"));
        expect(manualSubmit(tree).props.disabled).toBe(false);
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("checks in to the second link's event and lands only its answer", async () => {
    openedByLink("evt-1", "tok-a");
    const answers = pendingCheckIns();
    const tree = render();
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(1);

    moveTo(tree, OTHER_EVENT.id, "tok-b");
    await settle();
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: OTHER_EVENT.id, token: "tok-b" }),
    );

    await act(async () => answers[0].land());
    await settle();
    expect(screenText(tree)).not.toContain("You're checked in");
    expect(screenText(tree)).toContain("Checking you in");

    await act(async () => answers[1].land());
    await settle();
    expect(screenText(tree)).toContain("You're checked in");
    expect(screenText(tree)).toContain(OTHER_EVENT.name);
    expect(screenText(tree)).toContain("+5 pts");
    act(() => tree.unmount());
  });

  it("lands a check-in for the event the screen came back to", async () => {
    openedFromApp();
    const answer = pendingCheckIn();
    const tree = render();
    await submitManualCode(tree);

    moveTo(tree, OTHER_EVENT.id);
    moveTo(tree, "evt-1");
    expect(screenText(tree)).toContain("Checking you in");

    await act(async () => answer.land());
    await settle();
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  it("puts the last event's confirmation and refusal away when the screen moves", async () => {
    openedByLink();
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain("You're checked in");

    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).not.toContain("You're checked in");
    expect(screenText(tree)).toContain("Point your camera at the code");
    act(() => tree.unmount());
  });

  it("leaves the last event's location state behind", async () => {
    openedByLink();
    state.useEvent = (id) => ({
      data: id === OTHER_EVENT.id ? OTHER_EVENT : ZONED,
    });
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain("Allow location for Frapp");

    moveTo(tree, OTHER_EVENT.id);
    expect(screenText(tree)).not.toContain("Allow location for Frapp");
    act(() => tree.unmount());
  });

  it("doesn't send the last event's check-in again when the member comes back from Settings at another", async () => {
    openedByLink();
    state.useEvent = (id) => ({
      data: id === OTHER_EVENT.id ? OTHER_EVENT : ZONED,
    });
    locate.mockResolvedValue({ kind: "none", blocker: "denied" });
    const tree = render();
    await settle();
    await press(tree, "Open Settings");

    moveTo(tree, OTHER_EVENT.id);
    locate.mockImplementation(async () => located());
    await appState("active");
    expect(checkIn).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("Check-in's typed code", () => {
  beforeEach(() => openedFromApp());

  it("is typed in a sheet field, which rises with the keyboard", () => {
    // A plain `TextInput` at the foot of the screen sat under the keyboard on
    // Android, where the app-wide provider stops the window resizing (#3354).
    const tree = render();
    expect(manualInput(tree).type).toBe("BottomSheetTextInput");
    expect(tree.root.findAllByType("TextInput" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("shows a failed code in the sheet, where the member is typing", async () => {
    checkIn.mockRejectedValue(FAILED);
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);

    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(FAILED_SHOWN);
    act(() => tree.unmount());
  });

  it("keeps a link's refusal when the sheet opens: it is still true of a typed code", async () => {
    openedByLink();
    checkIn.mockRejectedValue(OUTSIDE_ZONE);
    const tree = render();
    await settle();
    expect(screenText(tree)).toContain(OUTSIDE_ZONE_SHOWN);

    openSheet(tree);
    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain(OUTSIDE_ZONE_SHOWN);
    act(() => tree.unmount());
  });

  it("shows the offline reason in the sheet and sends nothing", async () => {
    state.writeBlockedReason = "Reconnect to make changes";
    const tree = render();
    openSheet(tree);
    act(() => manualInput(tree).props.onChangeText("4KQ88"));

    const sheet = tree.root.findByType("BottomSheetModal" as never);
    expect(drawnText(sheet)).toContain("Reconnect to make changes");
    expect(manualSubmit(tree).props.disabled).toBe(true);
    expect(manualInput(tree).props.onSubmitEditing).toBeUndefined();
    act(() => tree.unmount());
  });

  it("sends the next typed code after a failed one", async () => {
    // The latch is released when the check-in fails as well as when it lands.
    checkIn.mockRejectedValueOnce(FAILED).mockResolvedValue({});
    const tree = render();
    openSheet(tree);
    await submitManualCode(tree);
    expect(screenText(tree)).toContain(FAILED_SHOWN);

    await submitManualCode(tree);
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(screenText(tree)).toContain("You're checked in");
    act(() => tree.unmount());
  });

  describe("the keyboard's Go key", () => {
    /** The member presses Go with the code typed so far. */
    async function pressGo(tree: ReactTestRenderer) {
      await act(async () => {
        manualInput(tree).props.onSubmitEditing?.();
      });
      await settle();
    }

    it("sends a plausible code", async () => {
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

    it("sends one check-in for a double tap", async () => {
      // Both presses land before the re-render that disables the button.
      checkIn.mockReturnValue(new Promise(() => undefined));
      const tree = render();
      act(() => manualInput(tree).props.onChangeText("4KQ88"));
      const pressSubmit = manualSubmit(tree).props.onPress;
      await act(async () => {
        pressSubmit();
        pressSubmit();
      });
      await settle();
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

/**
 * What the real `useCheckIn` makes of a response the API never shaped. An
 * edge's empty-bodied 5xx (during a deploy, say) is `error: undefined` or
 * `""` to openapi-fetch 0.17, so a hook that trusted `error` would resolve,
 * and the screen would confirm a check-in nothing wrote. Check-in has no
 * outbox: the member would leave believing they were on the roster.
 */
describe("Check-in on an empty-bodied 5xx", () => {
  beforeEach(() => {
    openedByLink();
    state.realCheckIn = true;
  });
  afterEach(() => {
    state.realCheckIn = false;
  });

  it("says the check-in didn't go through", async () => {
    for (const error of [undefined, ""] as const) {
      const post = vi.fn(async () => ({
        data: undefined,
        error,
        response: new Response(null, { status: 502 }),
      }));
      const tree = renderWithClient({ POST: post });
      try {
        await settle();
        expect(post).toHaveBeenCalledTimes(1);

        const text = screenText(tree);
        expect(text).not.toContain("You're checked in");
        expect(text).toContain("Couldn't check you in.");
        expect(successHaptic).not.toHaveBeenCalled();
        expect(
          AccessibilityInfo.announceForAccessibility,
        ).not.toHaveBeenCalled();
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("offers Try again, which sends the scanned link once more", async () => {
    // Re-tapping the camera's banner hands over the same link, which the
    // screen sent once already, so the retry has to be on the screen.
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 502 }),
      })
      .mockResolvedValueOnce({
        data: {},
        error: undefined,
        response: new Response(null, { status: 201 }),
      });
    const tree = renderWithClient({ POST: post });
    try {
      await settle();
      expect(post).toHaveBeenCalledTimes(1);
      await press(tree, "Try again");
      expect(post).toHaveBeenCalledTimes(2);
      expect(screenText(tree)).toContain("You're checked in");
      expect(pressablesDrawing(tree, "Try again")).toHaveLength(0);
    } finally {
      act(() => tree.unmount());
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
      await settle();
      expect(screenText(tree)).toContain("You're checked in");
    } finally {
      act(() => tree.unmount());
    }
  });
});

describe("Check-in's title (#2485)", () => {
  it("is the screen's heading, now that no navigator header names it", () => {
    openedFromApp();
    const tree = render();
    const headings = textHeadings(tree);

    expect(headings.map((node) => node.props.children)).toEqual(["Check in"]);
    act(() => tree.unmount());
  });
});

describe("Check-in's way out", () => {
  beforeEach(() => {
    vi.mocked(router().dismissTo).mockClear();
    vi.mocked(router().back).mockClear();
  });

  const close = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityLabel === "Close check-in",
    );

  it("closes with the app's glass close, not a bare ✕ (#3703)", () => {
    openedFromApp();
    const tree = render();
    expect(close(tree).props.testID).toBe("glass-close");
    act(() => tree.unmount());
  });

  it("goes to the event's detail, so a link from the camera lands on the event", () => {
    openedByLink();
    pendingCheckIn();
    const tree = render();
    act(() => close(tree).props.onPress());
    expect(router().dismissTo).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "evt-1" },
    });
    expect(router().back).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("pops back to the event detail it was opened from, as the swipe does", () => {
    openedFromApp();
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)" }, { name: "event-details" }],
      <FrappThemeProvider>
        <CheckInScreen />
      </FrappThemeProvider>,
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(element, {
        createNodeMock: (node) =>
          node.type === "BottomSheetModal" ? sheetHandle : null,
      });
    });
    act(() => close(tree).props.onPress());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(router().dismissTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("goes to Events when there is no event to go back to", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    const tree = render();
    act(() => close(tree).props.onPress());
    expect(router().dismissTo).toHaveBeenCalledWith("/events");
    act(() => tree.unmount());
  });

  it("closes the manual sheet when the member leaves", () => {
    // It is portalled above the navigator, so it would float over the event.
    openedFromApp();
    sheetHandle.dismiss.mockClear();
    const tree = render();
    openSheet(tree);

    act(() => blur());
    expect(sheetHandle.dismiss).toHaveBeenCalledTimes(1);

    act(() => refocus());
    act(() => tree.unmount());
  });
});
