import { describe, expect, it, vi } from "vitest";
import {
  createSwipeClaim,
  guardedBySwipe,
  SWIPE_CLAIM_GRACE_MS,
} from "./swipe-claim";

describe("a swipe's claim on its touch", () => {
  it("lets a plain tap through: the pan never activated", () => {
    let now = 1_000;
    const claim = createSwipeClaim(() => now);
    // A tap still finalizes the pan, which never took it over.
    claim.release();
    expect(claim.isClaimed()).toBe(false);
    now += 1;
    expect(claim.isClaimed()).toBe(false);
  });

  it("holds the touch from activation until a short grace after release", () => {
    let now = 1_000;
    const claim = createSwipeClaim(() => now);
    claim.claim();
    expect(claim.isClaimed()).toBe(true);
    now += 2_000;
    expect(claim.isClaimed()).toBe(true);
    claim.release();
    // The row's release can land just after the pan's.
    now += SWIPE_CLAIM_GRACE_MS - 1;
    expect(claim.isClaimed()).toBe(true);
    now += 1;
    expect(claim.isClaimed()).toBe(false);
    // The next touch's finalize starts no new grace.
    claim.release();
    expect(claim.isClaimed()).toBe(false);
  });

  it("drops a guarded handler only while claimed, and leaves it as given outside a swipe", () => {
    let now = 0;
    const claim = createSwipeClaim(() => now);
    const onPress = vi.fn();
    const guarded = guardedBySwipe(claim, onPress)!;
    claim.claim();
    guarded("event");
    expect(onPress).not.toHaveBeenCalled();
    claim.release();
    now += SWIPE_CLAIM_GRACE_MS;
    guarded("event");
    expect(onPress).toHaveBeenCalledWith("event");

    expect(guardedBySwipe(null, onPress)).toBe(onPress);
    expect(guardedBySwipe(claim, undefined)).toBeUndefined();
  });
});
