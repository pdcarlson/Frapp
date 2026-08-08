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

  it("bounds length so an oversized value cannot reach the column", () => {
    expect(isSupportedTimeZone("A".repeat(MAX_TIME_ZONE_LENGTH + 1))).toBe(
      false,
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(isSupportedTimeZone("  America/New_York  ")).toBe(true);
  });

  // Documented and deliberate: offsets are accepted because stored rows already
  // hold them. They are a poor choice (no DST), which is a UI steer, not a
  // validation error — see spec/behavior/notifications.md § Quiet Hours.
  it("accepts a fixed offset, which the spec permits but discourages", () => {
    expect(isSupportedTimeZone("-05:00")).toBe(true);
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
