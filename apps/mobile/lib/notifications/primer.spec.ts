import { describe, expect, it } from "vitest";
import { parsePrimerDecision, shouldOfferPrimer } from "./primer";

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
