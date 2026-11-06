import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_TIME_ZONE,
  isSupportedTimeZone,
  isUtcOffset,
  localTimeZone,
  timeZoneCity,
} from "./time-zone";

describe("isSupportedTimeZone", () => {
  it("accepts named zones the runtime can resolve", () => {
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("Europe/Berlin")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
  });

  it("rejects a zone the runtime cannot resolve", () => {
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
    expect(isSupportedTimeZone("America/Notacity")).toBe(false);
  });

  it("rejects blank and non-string input", () => {
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone("   ")).toBe(false);
    expect(isSupportedTimeZone(null)).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
    expect(isSupportedTimeZone(123)).toBe(false);
    expect(isSupportedTimeZone({})).toBe(false);
  });

  // Deliberately not asserted here: that the length bound *specifically* is
  // what rejects an oversized value. No resolvable zone is longer than
  // MAX_TIME_ZONE_LENGTH, so an over-length string is always unresolvable too
  // and the bound is not independently observable through this function — a
  // test claiming otherwise would pass whether or not the guard existed. The
  // bound that actually protects the column is `@MaxLength` on the DTO, which
  // apps/api/src/interface/dtos/notification.dto.spec.ts covers.

  it("ignores surrounding whitespace", () => {
    expect(isSupportedTimeZone("  America/New_York  ")).toBe(true);
  });

  // Fixed offsets are rejected by a pattern, not by asking `Intl` (#2361), so
  // this verdict is the same on every runtime and is safe to pin. That is the
  // difference from the rest of this file: whether `Intl` *would* resolve these
  // moved from "no" on Node 20 to "yes" on Node 22+, and a test pinning the
  // `Intl` answer went wrong with it.
  it("rejects fixed UTC offsets in every form, on any runtime", () => {
    for (const offset of [
      "-05:00",
      "+05:30",
      "-0500",
      "+0530",
      "-05",
      "+05",
      "+00:00",
      "+05:30:00",
      "\u221205:00", // U+2212 MINUS SIGN, which Node 24's Intl accepts
      "  -05:00  ",
    ]) {
      expect(isSupportedTimeZone(offset)).toBe(false);
    }
  });

  // The DST-free zone *names* stay accepted: they are zones, not offsets, and
  // narrowing to DST-aware zones is a separate decision (see the docblock).
  it("still accepts DST-free zone names", () => {
    expect(isSupportedTimeZone("Etc/GMT+5")).toBe(true);
    expect(isSupportedTimeZone("Etc/GMT-14")).toBe(true);
    expect(isSupportedTimeZone("EST")).toBe(true);
  });
});

// The offset guard must run before the fail-open, or a client on an ICU build
// that resolves no zones (a lean container, an older React Native JSC) would
// accept `-05:00` while the server rejects it. The zone probe runs once at
// import, so the module is re-imported under an `Intl` that resolves nothing.
describe("isSupportedTimeZone on a runtime that resolves no zones", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still rejects offsets while failing open on named zones", async () => {
    vi.stubGlobal("Intl", {
      ...Intl,
      DateTimeFormat: function DateTimeFormat() {
        throw new RangeError("no time zone support");
      },
    });
    vi.resetModules();
    const zoneless = await import("./time-zone");

    expect(zoneless.isSupportedTimeZone("-05:00")).toBe(false);
    expect(zoneless.isSupportedTimeZone("+0530")).toBe(false);
    expect(zoneless.isSupportedTimeZone("America/New_York")).toBe(true);
    expect(zoneless.isSupportedTimeZone("Mars/Olympus")).toBe(true);
  });
});

describe("isUtcOffset", () => {
  it("recognizes offset syntax and never a zone name", () => {
    expect(isUtcOffset("-05:00")).toBe(true);
    expect(isUtcOffset(" +05 ")).toBe(true);
    expect(isUtcOffset("\u221205:00")).toBe(true);
    expect(isUtcOffset("Etc/GMT+5")).toBe(false);
    expect(isUtcOffset("GMT-05:00")).toBe(false);
    expect(isUtcOffset("UTC")).toBe(false);
    expect(isUtcOffset("")).toBe(false);
  });
});

describe("timeZoneCity", () => {
  it("names the city, with spaces for underscores", () => {
    expect(timeZoneCity("America/Los_Angeles")).toBe("Los Angeles");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneCity("UTC")).toBe("UTC");
  });
});

describe("localTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function reportZone(timeZone: string) {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone,
    });
  }

  it("answers the runtime's named zone", () => {
    reportZone("Europe/Lisbon");
    expect(localTimeZone()).toBe("Europe/Lisbon");
  });

  // The server refuses offsets (#2361), so one must never seed a save.
  it("falls back when the runtime reports an offset", () => {
    reportZone("-05:00");
    expect(localTimeZone()).toBe(FALLBACK_TIME_ZONE);
  });
});
