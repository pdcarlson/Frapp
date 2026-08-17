import { describe, expect, it } from "vitest";
import {
  CHECK_IN_QR_PREFIX,
  isPlausibleManualCode,
  parseCheckInCode,
} from "./check-in-code";

describe("CHECK_IN_QR_PREFIX", () => {
  /**
   * The contract test. The API mints this prefix in
   * `apps/api/src/domain/utils/check-in-token.ts` (`CHECK_IN_QR_PREFIX`) and
   * nothing in the type system connects the two workspaces, so a change on
   * either side has to break here rather than in a member's hand at an event.
   */
  it("is the exact string the API mints", () => {
    expect(CHECK_IN_QR_PREFIX).toBe("frapp-checkin:v1");
  });
});

describe("parseCheckInCode", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  // Deliberately word-shaped rather than a realistic base64url digest: the
  // parser never inspects the token, and a random-looking blob here trips
  // gitleaks' generic-api-key entropy rule on every scan of this file.
  const token = "test-signature-placeholder";

  it("parses a payload minted by the API", () => {
    expect(parseCheckInCode(`${CHECK_IN_QR_PREFIX}:${eventId}:${token}`)).toEqual(
      { eventId, token },
    );
  });

  it("tolerates surrounding whitespace from the scanner", () => {
    expect(
      parseCheckInCode(`  ${CHECK_IN_QR_PREFIX}:${eventId}:${token}\n`),
    ).toEqual({ eventId, token });
  });

  it("keeps a token containing colons intact", () => {
    // Defensive against a future token format: everything after the event id is
    // the token, rather than the third of N colon-separated fields.
    expect(
      parseCheckInCode(`${CHECK_IN_QR_PREFIX}:${eventId}:a:b:c`),
    ).toEqual({ eventId, token: "a:b:c" });
  });

  it("returns null for codes that are not ours", () => {
    // The camera reads everything in the room; each of these must cost nothing.
    expect(parseCheckInCode("https://example.com")).toBeNull();
    expect(parseCheckInCode("WIFI:S:chapter-house;;")).toBeNull();
    expect(parseCheckInCode("")).toBeNull();
    expect(parseCheckInCode("   ")).toBeNull();
  });

  it("rejects a future prefix version rather than mis-reading it", () => {
    expect(
      parseCheckInCode(`frapp-checkin:v2:${eventId}:${token}`),
    ).toBeNull();
  });

  it("rejects a well-prefixed payload with a missing half", () => {
    expect(parseCheckInCode(`${CHECK_IN_QR_PREFIX}:${eventId}`)).toBeNull();
    expect(parseCheckInCode(`${CHECK_IN_QR_PREFIX}:${eventId}:`)).toBeNull();
    expect(parseCheckInCode(`${CHECK_IN_QR_PREFIX}::${token}`)).toBeNull();
  });
});

describe("isPlausibleManualCode", () => {
  it("accepts the drawn shape however it is punctuated", () => {
    expect(isPlausibleManualCode("4KQ-88")).toBe(true);
    expect(isPlausibleManualCode("4kq88")).toBe(true);
    expect(isPlausibleManualCode(" 4KQ 88 ")).toBe(true);
  });

  it("rejects lengths that cannot be a code", () => {
    expect(isPlausibleManualCode("")).toBe(false);
    expect(isPlausibleManualCode("4KQ")).toBe(false);
    expect(isPlausibleManualCode("4KQ-8888")).toBe(false);
  });
});
