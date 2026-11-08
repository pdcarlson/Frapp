import { beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  acceptPrimer,
  answerPushAsk,
  declinePrimer,
  parsePrimerDecision,
  PUSH_PRIMER_DECLINED_AT_KEY,
  PUSH_PRIMER_STORAGE_KEY,
  PUSH_REMINDER_DELAY_MS,
  shouldOfferPrimer,
  shouldOfferReminder,
} from "./primer";
import type { PushState } from "./push-state";

const requestPushPermission = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

const notifyPushPermissionGranted = vi.hoisted(() => vi.fn());

/** `Linking` isn't in the suite's `react-native` stub; this spec adds it. */
const { openSettings } = vi.hoisted(() => ({
  openSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return { ...reactNativeStub, Linking: { openSettings } };
});

vi.mock("@/lib/notifications/push", () => ({
  requestPushPermission: () => requestPushPermission(),
}));

/** The live read `answerPushAsk` makes; the pure checks stay real. */
const readPushState = vi.hoisted(() => vi.fn());
vi.mock("./push-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./push-state")>()),
  readPushState: () => readPushState(),
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

/** A phone's push answer, off and still able to ask, unless overridden. */
function pushState(over: Partial<PushState> = {}): PushState {
  return {
    granted: false,
    canAskAgain: true,
    status: "undetermined",
    channelBlocked: false,
    ...over,
  };
}

const ON = pushState({ granted: true, status: "granted" });

describe("shouldOfferPrimer", () => {
  it("offers when nothing has been asked and push is off", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        push: pushState(),
        decision: "unasked",
      }),
    ).toBe(true);
  });

  it("stays quiet once the member has answered either way", () => {
    // "Not now" comes back once, as the chat home's reminder, never as this
    // step again.
    for (const decision of ["declined", "accepted"] as const) {
      expect(
        shouldOfferPrimer({ isAvailable: true, push: pushState(), decision }),
      ).toBe(false);
    }
  });

  it("stays quiet once push is on", () => {
    expect(
      shouldOfferPrimer({ isAvailable: true, push: ON, decision: "unasked" }),
    ).toBe(false);
  });

  // Android 13+ reports `granted` from POST_NOTIFICATIONS alone, and the
  // app's notifications blocked only in `status`. That phone shows nothing,
  // so it still has something to ask (in the phone's settings).
  it("still offers when Android reports granted but blocked", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        push: pushState({
          granted: true,
          status: "denied",
          canAskAgain: false,
        }),
        decision: "unasked",
      }),
    ).toBe(true);
  });

  it("still offers when the app's Android channel is switched off", () => {
    expect(
      shouldOfferPrimer({
        isAvailable: true,
        push: { ...ON, channelBlocked: true },
        decision: "unasked",
      }),
    ).toBe(true);
  });

  it("does not flash while the push read is still in flight", () => {
    expect(
      shouldOfferPrimer({ isAvailable: true, push: null, decision: "unasked" }),
    ).toBe(false);
  });

  // #2299. The step's only function is "Turn on", so in a build that cannot
  // push it would render dead. It is skipped instead, like the Ask pill.
  it("is omitted when push is unavailable, whatever push reads", () => {
    for (const push of [null, pushState()]) {
      expect(
        shouldOfferPrimer({ isAvailable: false, push, decision: "unasked" }),
      ).toBe(false);
    }
  });
});

describe("shouldOfferReminder", () => {
  const NOW = 1_800_000_000_000;
  const base = {
    isAvailable: true,
    push: pushState(),
    declinedAt: null,
    reminderDone: false,
    now: NOW,
  };

  it("waits three days after a Not now, then asks", () => {
    const decision = "declined" as const;
    expect(
      shouldOfferReminder({
        ...base,
        decision,
        declinedAt: NOW - PUSH_REMINDER_DELAY_MS + 60_000,
      }),
    ).toBe(false);
    expect(
      shouldOfferReminder({
        ...base,
        decision,
        declinedAt: NOW - PUSH_REMINDER_DELAY_MS,
      }),
    ).toBe(true);
  });

  it("treats a decline with no stored time as old", () => {
    expect(shouldOfferReminder({ ...base, decision: "declined" })).toBe(true);
  });

  it("asks a member who was never asked (joined before the step)", () => {
    expect(shouldOfferReminder({ ...base, decision: "unasked" })).toBe(true);
  });

  it("never follows a Turn on, whatever the OS answered", () => {
    expect(shouldOfferReminder({ ...base, decision: "accepted" })).toBe(false);
  });

  it("asks only once", () => {
    expect(
      shouldOfferReminder({ ...base, decision: "unasked", reminderDone: true }),
    ).toBe(false);
  });

  it("stays quiet with push on, unread, or unavailable", () => {
    expect(
      shouldOfferReminder({ ...base, decision: "unasked", push: ON }),
    ).toBe(false);
    expect(
      shouldOfferReminder({ ...base, decision: "unasked", push: null }),
    ).toBe(false);
    expect(
      shouldOfferReminder({ ...base, decision: "unasked", isAvailable: false }),
    ).toBe(false);
  });
});

describe("declinePrimer", () => {
  it("records the decline and when it happened", async () => {
    vi.mocked(AsyncStorage.setItem).mockClear();
    await declinePrimer(AsyncStorage, 1234);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_STORAGE_KEY,
      "declined",
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_DECLINED_AT_KEY,
      "1234",
    );
  });
});

describe("answerPushAsk", () => {
  beforeEach(() => {
    requestPushPermission.mockReset().mockResolvedValue(true);
    readPushState.mockReset().mockResolvedValue(pushState());
    openSettings.mockClear();
    vi.mocked(AsyncStorage.setItem).mockClear();
  });

  it("shows the OS prompt while one can still appear", async () => {
    await expect(answerPushAsk()).resolves.toBe("allowed");
    expect(requestPushPermission).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();

    requestPushPermission.mockResolvedValue(false);
    await expect(answerPushAsk()).resolves.toBe("denied");
  });

  it("still asks the OS when the push read fails", async () => {
    readPushState.mockRejectedValue(new Error("read failed"));
    await expect(answerPushAsk()).resolves.toBe("allowed");
    expect(requestPushPermission).toHaveBeenCalledTimes(1);
  });

  // The member turned push on in the phone's settings after the step drew.
  it("records accepted without a prompt when push is already on", async () => {
    readPushState.mockResolvedValue(ON);
    const onRecorded = vi.fn();
    await expect(answerPushAsk(onRecorded)).resolves.toBe("allowed");
    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_STORAGE_KEY,
      "accepted",
    );
  });

  // iOS after an earlier Don't Allow, Android after a second one: the OS
  // answers a request at once with no dialog, so a tap that only asked would
  // do nothing visible. Whether they turn it on there is unknown, so it
  // counts as a Not now: the chat home's reminder can still ask later.
  it("opens the phone's settings when no prompt can appear", async () => {
    readPushState.mockResolvedValue(
      pushState({ canAskAgain: false, status: "denied" }),
    );
    const onRecorded = vi.fn();
    await expect(answerPushAsk(onRecorded)).resolves.toBe("settings");
    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_STORAGE_KEY,
      "declined",
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_DECLINED_AT_KEY,
      expect.any(String),
    );
  });

  it("opens settings for the Android 13+ granted-but-blocked case", async () => {
    readPushState.mockResolvedValue(
      pushState({ granted: true, status: "denied", canAskAgain: false }),
    );
    await expect(answerPushAsk()).resolves.toBe("settings");
    expect(requestPushPermission).not.toHaveBeenCalled();
  });
});

/**
 * The one accept sequence, shared by onboarding's "Turn on" and s16
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
