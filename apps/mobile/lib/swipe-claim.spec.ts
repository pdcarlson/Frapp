import { describe, expect, it, vi } from "vitest";
import {
  createSwipeClaim,
  guardedBySwipe,
  SWIPE_CLAIM_MAX_MS,
} from "./swipe-claim";

describe("a swipe's claim on its touch", () => {
  it("lets a plain tap through: the pan never activated", () => {
    const claim = createSwipeClaim(() => 1_000);
    claim.begin();
    // A tap still finalizes the pan, which never took it over.
    claim.release();
    expect(claim.isClaimed()).toBe(false);
  });

  it("holds from activation until the next touch begins", () => {
    let now = 1_000;
    const claim = createSwipeClaim(() => now);
    claim.begin();
    claim.claim();
    expect(claim.isClaimed()).toBe(true);
    now += 5_000;
    expect(claim.isClaimed()).toBe(true);
    claim.release();
    // The row's release can reach the JS thread late, after Messages mounts.
    now += SWIPE_CLAIM_MAX_MS - 1;
    expect(claim.isClaimed()).toBe(true);
    claim.begin();
    expect(claim.isClaimed()).toBe(false);
  });

  it("lapses on its own a moment after release if no touch follows", () => {
    let now = 1_000;
    const claim = createSwipeClaim(() => now);
    claim.claim();
    claim.release();
    now += SWIPE_CLAIM_MAX_MS;
    expect(claim.isClaimed()).toBe(false);
    // The next touch's finalize leaves nothing behind.
    claim.release();
    expect(claim.isClaimed()).toBe(false);
  });

  it("drops a guarded handler only while claimed, and leaves it as given outside a swipe", () => {
    const claim = createSwipeClaim(() => 0);
    const onPress = vi.fn();
    const guarded = guardedBySwipe(claim, onPress)!;
    claim.claim();
    guarded("event");
    expect(onPress).not.toHaveBeenCalled();
    claim.begin();
    guarded("event");
    expect(onPress).toHaveBeenCalledWith("event");

    expect(guardedBySwipe(null, onPress)).toBe(onPress);
    expect(guardedBySwipe(claim, undefined)).toBeUndefined();
  });
});
