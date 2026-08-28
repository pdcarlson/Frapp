import { describe, expect, it } from "vitest";
import {
  connectionBannerCopy,
  deriveConnectionState,
  DEGRADED_THRESHOLD,
  writeBlockedReason,
} from "./state";

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
  });

  it("is DEGRADED while failures are accumulating below the threshold", () => {
    for (let n = 1; n < DEGRADED_THRESHOLD; n += 1) {
      expect(
        deriveConnectionState({ linkOffline: false, consecutiveFailures: n }),
      ).toBe("DEGRADED");
    }
  });

  it("is OFFLINE at the threshold, as the spec states", () => {
    // `spec/ui/resilience.md` § 2: "'OFFLINE': !navigator.onLine OR health
    // check to /health fails 3 times". `apps/web`'s provider maps this same
    // threshold to DEGRADED and never reaches OFFLINE from probing — a real
    // divergence, filed rather than fixed from a mobile slice.
    expect(
      deriveConnectionState({
        linkOffline: false,
        consecutiveFailures: DEGRADED_THRESHOLD,
      }),
    ).toBe("OFFLINE");
  });
});

describe("connectionBannerCopy", () => {
  it("says nothing when online", () => {
    expect(connectionBannerCopy("ONLINE")).toBeNull();
  });

  it("carries the spec's sentences, without its emoji", () => {
    expect(connectionBannerCopy("DEGRADED")).toBe(
      "Slow connection. Some features may be delayed.",
    );
    expect(connectionBannerCopy("OFFLINE")).toBe(
      "You're offline. Showing cached data.",
    );
    expect(connectionBannerCopy("DEGRADED")).not.toMatch(
      /[\u{1F300}-\u{1FAFF}⚡]/u,
    );
    expect(connectionBannerCopy("OFFLINE")).not.toMatch(
      /[\u{1F300}-\u{1FAFF}⚡]/u,
    );
  });
});

describe("writeBlockedReason", () => {
  it("blocks only when offline", () => {
    expect(writeBlockedReason("ONLINE")).toBeNull();
    // DEGRADED explicitly does not block: § 2's table keeps write actions
    // "Enabled (with extended timeouts)" there.
    expect(writeBlockedReason("DEGRADED")).toBeNull();
    expect(writeBlockedReason("OFFLINE")).toBe("Reconnect to make changes.");
  });
});
