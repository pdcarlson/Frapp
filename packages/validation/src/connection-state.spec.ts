import { describe, expect, it } from "vitest";
import {
  DEGRADED_THRESHOLD,
  connectionIndicator,
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

describe("connectionIndicator (one indicator for the app and the open chat)", () => {
  it("says nothing on a healthy connection, with or without a live chat", () => {
    expect(connectionIndicator("ONLINE", null)).toBeNull();
    expect(connectionIndicator("ONLINE", "live")).toBeNull();
  });

  it("says Offline, and promises the queue only while a chat is open", () => {
    expect(connectionIndicator("OFFLINE", null)).toEqual({
      tone: "danger",
      label: "Offline",
      description: "You're offline. Showing cached data.",
    });
    const inChat = connectionIndicator("OFFLINE", "offline");
    expect(inChat?.label).toBe("Offline");
    expect(inChat?.description).toMatch(/go out when you reconnect/);
    // A transport that calls itself offline on an app that does not is still
    // one "Offline", never a second pill.
    expect(connectionIndicator("ONLINE", "offline")?.label).toBe("Offline");
  });

  it("lets the app's slow connection speak over the transport's symptoms", () => {
    for (const transport of [null, "live", "reconnecting", "polling"] as const) {
      expect(connectionIndicator("DEGRADED", transport)).toEqual({
        tone: "warning",
        label: "Slow connection",
        description: "Slow connection. Some features may be delayed.",
      });
    }
  });

  it("reports the transport only on an otherwise healthy connection", () => {
    expect(connectionIndicator("ONLINE", "polling")).toEqual({
      tone: "warning",
      label: "Live updates paused",
      description: "Real-time updates paused. Polling for new messages.",
    });
    expect(connectionIndicator("ONLINE", "reconnecting")?.label).toBe(
      "Reconnecting…",
    );
  });

  it("never draws an emoji", () => {
    const all = (["ONLINE", "DEGRADED", "OFFLINE"] as const).flatMap((state) =>
      ([null, "live", "polling", "reconnecting", "offline"] as const).map(
        (transport) => connectionIndicator(state, transport),
      ),
    );
    for (const indicator of all) {
      expect(`${indicator?.label} ${indicator?.description}`).not.toMatch(
        /[\u{1F300}-\u{1FAFF}⚡]/u,
      );
    }
  });
});
