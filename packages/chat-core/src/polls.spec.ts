import { describe, expect, it } from "vitest";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
  pollsGateOf,
  pollsGateReason,
} from "./polls";

describe("pollsGateOf (#3012)", () => {
  it("answers from the cache whatever the read is doing", () => {
    for (const fetchStatus of ["fetching", "paused", "idle"] as const) {
      expect(pollsGateOf({ pollsEnabled: true, fetchStatus })).toBe("on");
      expect(pollsGateOf({ pollsEnabled: false, fetchStatus })).toBe("off");
    }
  });

  it("is loading only while a read with nothing cached is running", () => {
    expect(
      pollsGateOf({ pollsEnabled: undefined, fetchStatus: "fetching" }),
    ).toBe("loading");
  });

  it("fails closed, not open, on a failed, paused or disabled read with nothing cached", () => {
    // Nothing is checking in any of these, so "Checking…" would be a lie and
    // a live Vote would contradict design-system §4.
    expect(
      pollsGateOf({ pollsEnabled: undefined, fetchStatus: "paused" }),
    ).toBe("error");
    expect(pollsGateOf({ pollsEnabled: undefined, fetchStatus: "idle" })).toBe(
      "error",
    );
  });
});

describe("pollsGateReason (#3012)", () => {
  const open = { isClosed: false, isConfirmed: true };

  it("says why an open, confirmed poll's Vote is withdrawn", () => {
    expect(pollsGateReason("on", open)).toBeNull();
    expect(pollsGateReason("off", open)).toBe(POLLS_OFF_COPY);
    expect(pollsGateReason("loading", open)).toBe(POLLS_GATE_LOADING_COPY);
    expect(pollsGateReason("error", open)).toBe(POLLS_GATE_ERROR_COPY);
  });

  it("gives no reason to a card that takes no vote anyway", () => {
    for (const gate of ["off", "loading", "error"] as const) {
      expect(pollsGateReason(gate, { ...open, isClosed: true })).toBeNull();
      // A pending or failed row: its delivery chrome already says why, and a
      // refused send says POLLS_OFF_COPY there.
      expect(pollsGateReason(gate, { ...open, isConfirmed: false })).toBeNull();
    }
  });
});
