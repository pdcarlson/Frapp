/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

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

const checkIn = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEvent: () => ({ data: EVENT }),
  useCheckIn: () => ({ mutateAsync: checkIn, isPending: false }),
}));

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
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import CheckInScreen from "@/app/(tabs)/check-in";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void })
  .__refocus;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <CheckInScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const camera = (tree: ReactTestRenderer) =>
  tree.root.findByType("CameraView" as never);

const manualSubmit = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "Submit manual check-in code" &&
      node.type === ("Pressable" as never),
  );

/** Types a plausible code and submits it, settling the async submit. */
async function submitManualCode(tree: ReactTestRenderer) {
  const input = tree.root.find(
    (node) => node.props.accessibilityLabel === "Manual check-in code",
  );
  act(() => input.props.onChangeText("4KQ88"));
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
    // The same instance serves the next event, and `success` disarms the
    // decoder just as a refusal does. Without the reset the camera is live but
    // deaf at the next event, under "You're checked in" for the previous one.
    checkIn.mockResolvedValue({});
    const tree = render();
    await submitManualCode(tree);
    expect(screenText(tree)).toContain("You're checked in. +10 pts");
    expect(camera(tree).props.onBarcodeScanned).toBeUndefined();

    act(() => refocus());

    expect(screenText(tree)).not.toContain("You're checked in");
    expect(camera(tree).props.onBarcodeScanned).toEqual(expect.any(Function));
    act(() => tree.unmount());
  });
});
