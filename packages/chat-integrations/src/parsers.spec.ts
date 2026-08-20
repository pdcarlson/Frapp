import { POINTS_REASON_MAX_LENGTH } from "@repo/validation";
import { describe, expect, it } from "vitest";
import { parsePointsArgs } from "./parsers";

describe("parsePointsArgs reason cap", () => {
  it("imports POINTS_REASON_MAX_LENGTH from @repo/validation at the 500-char pin", () => {
    // Drift detector: if the shared constant moves, this pin fails until the
    // parser spec (and the API DTO that shares it) are updated together.
    expect(POINTS_REASON_MAX_LENGTH).toBe(500);
  });

  it("accepts a reason of exactly POINTS_REASON_MAX_LENGTH and rejects one more", () => {
    const atCap = parsePointsArgs(
      `grant @alice 5 for ${"x".repeat(POINTS_REASON_MAX_LENGTH)}`,
    );
    expect(atCap.ok).toBe(true);

    const over = parsePointsArgs(
      `grant @alice 5 for ${"x".repeat(POINTS_REASON_MAX_LENGTH + 1)}`,
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error).toContain(String(POINTS_REASON_MAX_LENGTH));
  });
});
