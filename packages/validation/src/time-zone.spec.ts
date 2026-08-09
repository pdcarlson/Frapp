import { describe, expect, it } from "vitest";
import {
  isSupportedTimeZone,
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

  // Offset forms are NOT portable, and this test used to assert they were
  // accepted — true on the Node 22 sandbox it was written on, false on the
  // Node 20 that CI and the Dockerfile actually run. Pinning either answer
  // repeats the mistake this whole module exists to prevent: treating one
  // runtime's timezone verdict as universal. Assert instead the invariant that
  // holds everywhere — the predicate and the normalizer never disagree, so a
  // client and the server reach the same conclusion on the same runtime.
  it("keeps isSupportedTimeZone and normalizeTimeZoneInput in agreement", () => {
    for (const candidate of ["-05:00", "+05:30", "Etc/GMT+5", "EST", "UTC"]) {
      const accepted = isSupportedTimeZone(candidate);
      const normalized = normalizeTimeZoneInput(candidate);
      expect(normalized === undefined).toBe(!accepted);
      if (accepted) expect(normalized).toBe(candidate);
    }
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
    expect(normalizeTimeZoneInput(42)).toBeUndefined();
    expect(
      normalizeTimeZoneInput("A".repeat(MAX_TIME_ZONE_LENGTH + 1)),
    ).toBeUndefined();
  });
});
