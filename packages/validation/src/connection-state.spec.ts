import { describe, expect, it } from "vitest";
import {
  DEGRADED_THRESHOLD,
  deriveConnectionState,
  healthProbeIsReachable,
  type ConnectionState,
} from "./connection-state";

describe("deriveConnectionState", () => {
  it("is ONLINE with a link and no failures", () => {
    expect(
      deriveConnectionState({ linkOffline: false, consecutiveFailures: 0 }),
    ).toBe("ONLINE");
  });

  it("is OFFLINE with no link, regardless of probe history", () => {
    expect(
      deriveConnectionState({ linkOffline: true, consecutiveFailures: 0 }),
    ).toBe("OFFLINE");
    expect(
      deriveConnectionState({
        linkOffline: true,
        consecutiveFailures: DEGRADED_THRESHOLD,
      }),
    ).toBe("OFFLINE");
  });

  it("is DEGRADED while failures are accumulating below the threshold", () => {
    for (let n = 1; n < DEGRADED_THRESHOLD; n += 1) {
      expect(
        deriveConnectionState({ linkOffline: false, consecutiveFailures: n }),
      ).toBe("DEGRADED");
    }
  });

  it("is OFFLINE at the threshold, as the spec states", () => {
    expect(
      deriveConnectionState({
        linkOffline: false,
        consecutiveFailures: DEGRADED_THRESHOLD,
      }),
    ).toBe("OFFLINE");
  });

  it("covers the whole input domain used by both apps", () => {
    const expected: Array<{
      linkOffline: boolean;
      consecutiveFailures: number;
      state: ConnectionState;
    }> = [
      { linkOffline: false, consecutiveFailures: 0, state: "ONLINE" },
      { linkOffline: false, consecutiveFailures: 1, state: "DEGRADED" },
      { linkOffline: false, consecutiveFailures: 2, state: "DEGRADED" },
      { linkOffline: false, consecutiveFailures: 3, state: "OFFLINE" },
      { linkOffline: false, consecutiveFailures: 4, state: "OFFLINE" },
      { linkOffline: true, consecutiveFailures: 0, state: "OFFLINE" },
      { linkOffline: true, consecutiveFailures: 1, state: "OFFLINE" },
      { linkOffline: true, consecutiveFailures: 3, state: "OFFLINE" },
    ];
    for (const row of expected) {
      expect(
        deriveConnectionState({
          linkOffline: row.linkOffline,
          consecutiveFailures: row.consecutiveFailures,
        }),
      ).toBe(row.state);
    }
  });
});

describe("healthProbeIsReachable", () => {
  it("treats 2xx as reachable", () => {
    expect(healthProbeIsReachable({ ok: true, status: 200 })).toBe(true);
  });

  it("treats 429 as reachable — the API is up and throttling", () => {
    expect(healthProbeIsReachable({ ok: false, status: 429 })).toBe(true);
  });

  it("treats other non-ok statuses as unreachable", () => {
    expect(healthProbeIsReachable({ ok: false, status: 503 })).toBe(false);
    expect(healthProbeIsReachable({ ok: false, status: 500 })).toBe(false);
  });

  it("treats a mock that only sets ok as a failure when ok is false", () => {
    expect(healthProbeIsReachable({ ok: false })).toBe(false);
  });
});
