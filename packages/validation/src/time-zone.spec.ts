import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSupportedTimeZone,
  isUtcOffset,
  normalizeTimeZoneInput,
  MAX_TIME_ZONE_LENGTH,
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

  // The predicate and the normalizer must never disagree, so a client and the
  // server reach the same conclusion on the same runtime. This asserts the
  // agreement, not what either answers, so it holds whatever `Intl` decides.
  it("keeps isSupportedTimeZone and normalizeTimeZoneInput in agreement", () => {
    for (const candidate of ["-05:00", "+05:30", "Etc/GMT+5", "EST", "UTC"]) {
      const accepted = isSupportedTimeZone(candidate);
      const normalized = normalizeTimeZoneInput(candidate);
      expect(normalized === undefined).toBe(!accepted);
      if (accepted) expect(normalized).toBe(candidate);
    }
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

describe("normalizeTimeZoneInput", () => {
  // This null-vs-undefined contract is the sole gate on the web save path, and
  // conflating the two is precisely how a partial PATCH wipes a stored zone.
  it("returns null for an explicit clear", () => {
    expect(normalizeTimeZoneInput(null)).toBeNull();
    expect(normalizeTimeZoneInput("")).toBeNull();
    expect(normalizeTimeZoneInput("   ")).toBeNull();
  });

  it("returns null for undefined — callers must treat absent separately", () => {
    // Callers that can distinguish "field never loaded" MUST check for
    // `undefined` before calling this, or they will send a clear they did not
    // mean. apps/web/components/profile/profile-panel.tsx does exactly that.
    expect(normalizeTimeZoneInput(undefined)).toBeNull();
  });

  it("returns the trimmed value for an accepted zone", () => {
    expect(normalizeTimeZoneInput("  America/Chicago ")).toBe(
      "America/Chicago",
    );
  });

  it("returns undefined for a value the server would reject", () => {
    expect(normalizeTimeZoneInput("Mars/Olympus")).toBeUndefined();
    expect(normalizeTimeZoneInput("-05:00")).toBeUndefined();
    expect(normalizeTimeZoneInput(42)).toBeUndefined();
    expect(
      normalizeTimeZoneInput("A".repeat(MAX_TIME_ZONE_LENGTH + 1)),
    ).toBeUndefined();
  });
});
