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

  it("still renders when push is unavailable, to say why", () => {
    // This is the state of every build until #938 provisions an EAS project,
    // and permission cannot even be read there — so `permissionGranted` is
    // null and the availability check has to come first.
    expect(
      shouldOfferPrimer({
        isAvailable: false,
        permissionGranted: null,
        decision: "unasked",
      }),
    ).toBe(true);
  });
});
