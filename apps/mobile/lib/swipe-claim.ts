import { createContext, useContext } from "react";

/**
 * A screen-wide swipe owns the touch it took over, so the row under the
 * finger never also opens (Paul, 2026-11-12: a swipe from Chat home into
 * Messages also opened the channel the swipe started on, which then covered
 * Messages).
 *
 * Why a row needs telling: a list row is a React Native `Pressable`, and a
 * press is cancelled only when the finger leaves the row's press area. A
 * channel row spans the screen, so an 80 point slide left never leaves it, and
 * the release counts as a tap. The pan's activation is meant to cancel the
 * `Pressable` (gesture-handler cancels JS touch responders when a gesture
 * activates), but on device it did not, so the swipe opened Messages and the
 * row pushed its channel on top in the same release.
 *
 * The swipe's pan calls `claim` when it activates and `release` when it
 * finishes, however it finishes. A press arriving while the pan holds the
 * touch, or within {@link SWIPE_CLAIM_GRACE_MS} after it let go, belongs to
 * the swipe and is dropped: gesture-handler's callbacks and the row's release
 * arrive on the JS thread in no promised order. A plain tap never activates
 * the pan, so it never claims and its press goes through at once.
 */
export const SWIPE_CLAIM_GRACE_MS = 300;

export type SwipeClaim = {
  /** The pan took the touch over. */
  claim: () => void;
  /** The pan finished: ended, failed, or cancelled. */
  release: () => void;
  /** Whether a press arriving now came from the swipe's touch. */
  isClaimed: () => boolean;
};

export function createSwipeClaim(now: () => number = Date.now): SwipeClaim {
  let holding = false;
  let releasedAt = Number.NEGATIVE_INFINITY;
  return {
    claim() {
      holding = true;
    },
    release() {
      // Every touch finalizes the pan, a tap included; only one it took over
      // starts the grace.
      if (!holding) return;
      holding = false;
      releasedAt = now();
    },
    isClaimed() {
      return holding || now() - releasedAt < SWIPE_CLAIM_GRACE_MS;
    },
  };
}

const SwipeClaimContext = createContext<SwipeClaim | null>(null);

/** Given by the swipe's area to everything inside it. */
export const SwipeClaimProvider = SwipeClaimContext.Provider;

/** The enclosing swipe's claim, or `null` outside any swipe area. */
export function useSwipeClaim(): SwipeClaim | null {
  return useContext(SwipeClaimContext);
}

/**
 * `handler`, dropped while the enclosing swipe holds the touch. Outside a
 * swipe area it is `handler` as given.
 */
export function guardedBySwipe<Args extends unknown[]>(
  claim: SwipeClaim | null,
  handler: ((...args: Args) => void) | null | undefined,
): ((...args: Args) => void) | null | undefined {
  if (!claim || !handler) return handler;
  return (...args: Args) => {
    if (!claim.isClaimed()) handler(...args);
  };
}
