import { beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  acceptPrimer,
  parsePrimerDecision,
  PUSH_PRIMER_STORAGE_KEY,
  shouldOfferPrimer,
} from "./primer";

const requestPushPermission = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

const notifyPushPermissionGranted = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notifications/push", () => ({
  requestPushPermission: () => requestPushPermission(),
}));

vi.mock("./push-token-lifecycle", () => ({
  notifyPushPermissionGranted: () => notifyPushPermissionGranted(),
}));

describe("parsePrimerDecision", () => {
  it("reads the two stored values", () => {
    expect(parsePrimerDecision("declined")).toBe("declined");
    expect(parsePrimerDecision("accepted")).toBe("accepted");
  });

  it("treats anything else as unasked", () => {
    expect(parsePrimerDecision(null)).toBe("unasked");
    expect(parsePrimerDecision("")).toBe("unasked");
    expect(parsePrimerDecision("yes")).toBe("unasked");
  });
});

describe("shouldOfferPrimer", () => {
  it("offers when nothing has been asked and permission is not granted", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        permissionGranted: false,
        decision: "unasked",
      }),
    ).toBe(true);
  });

  it("stays quiet once the member has answered either way", () => {
    // "Not now" is an answer, not a deferral — a primer that reappears every
    // launch is the nag the contextual pattern exists to avoid.
    for (const decision of ["declined", "accepted"] as const) {
      expect(
        shouldOfferPrimer({
          isAvailable: true,
          permissionGranted: false,
          decision,
        }),
      ).toBe(false);
    }
  });

  it("stays quiet once permission is granted", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        permissionGranted: true,
        decision: "unasked",
      }),
    ).toBe(false);
  });

  it("does not flash while the permission read is still in flight", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        permissionGranted: null,
        decision: "unasked",
      }),
    ).toBe(false);
  });

  // #2299. The card's only function is "Turn on", so in a build that cannot
  // push it would render dead: a disabled CTA and an apology, on the first
  // screen after joining. It is omitted instead, like the Ask pill.
  it("is omitted when push is unavailable, whatever permission reads", () => {
    // `null`: Expo Go or web, where the module (and so permission) is absent.
    // `false`: the module loads but no EAS project id is configured, so
    // permission reads fine while no token could ever register.
    for (const permissionGranted of [null, false] as const) {
      expect(
        shouldOfferPrimer({
          isAvailable: false,
          permissionGranted,
          decision: "unasked",
        }),
      ).toBe(false);
    }
  });
});

/**
 * The one accept sequence, shared by the s03 card's "Turn on" and s16
 * Settings' push switch.
 */
describe("acceptPrimer", () => {
  beforeEach(() => {
    requestPushPermission.mockReset().mockResolvedValue(true);
    notifyPushPermissionGranted.mockClear();
    vi.mocked(AsyncStorage.setItem).mockClear();
  });

  it("asks the push runtime to register again on a grant, and only then (#2617)", async () => {
    await acceptPrimer();
    expect(notifyPushPermissionGranted).toHaveBeenCalledTimes(1);

    notifyPushPermissionGranted.mockClear();
    requestPushPermission.mockResolvedValue(false);
    await acceptPrimer();
    expect(notifyPushPermissionGranted).not.toHaveBeenCalled();
  });

  it("stores the decision, then runs onRecorded, then asks the OS", async () => {
    const order: string[] = [];
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(
      async (key, value) => {
        order.push(`stored ${key}=${value}`);
      },
    );
    requestPushPermission.mockImplementation(async () => {
      order.push("asked");
      return true;
    });

    await expect(acceptPrimer(() => order.push("recorded"))).resolves.toBe(
      true,
    );
    expect(order).toEqual([
      `stored ${PUSH_PRIMER_STORAGE_KEY}=accepted`,
      "recorded",
      "asked",
    ]);
  });

  it("resolves false, without rejecting, when the OS prompt fails", async () => {
    requestPushPermission.mockRejectedValue(new Error("native module"));

    await expect(acceptPrimer()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_STORAGE_KEY,
      "accepted",
    );
  });
});
