import { createContext, useContext } from "react";

/**
 * A screen-wide swipe owns the touch it took over, so the control under the
 * finger never also acts (Paul, 2026-11-12: a swipe from Chat home into
 * Messages also opened the channel the swipe started on, which then covered
 * Messages).
 *
 * Why a row needs telling: a list row is a React Native `Pressable`, and a
 * press is cancelled only when the finger leaves the row's press area. A
 * channel row spans the screen, so an 80 point slide left never leaves it, and
 * the release counts as a tap. The pan's activation is meant to cancel the
 * `Pressable` (gesture-handler cancels JS touch responders when a gesture
 * activates), but on device it did not, so the swipe opened Messages and the
 * row pushed its channel on top in the same release. A small control (the
 * Messages door, an icon button) can keep a short flick inside its press
 * area the same way.
 *
 * The swipe's pan calls `claim` when it activates and `begin` when the next
 * touch starts. Everything in between belongs to the swipe, so a press that
 * reaches the JS thread late, after Messages has mounted on a slow phone, is
 * still dropped: gesture-handler's callbacks and the control's release arrive
 * in no promised order and at no promised delay. `release` marks when the
 * swipe's finger lifted, and the claim lapses {@link SWIPE_CLAIM_MAX_MS} after
 * it even if no next touch reaches the pan, so it can never hold the screen's
 * taps for long. A plain tap never activates the pan, so it never claims and
 * its press goes through at once.
 */
export const SWIPE_CLAIM_MAX_MS = 1_000;

export type SwipeClaim = {
  /** A new touch started: whatever the last swipe held is over. */
  begin: () => void;
  /** The pan took the touch over. */
  claim: () => void;
  /** The pan finished: ended, failed, or cancelled. */
  release: () => void;
  /** Whether a press arriving now came from the swipe's touch. */
  isClaimed: () => boolean;
};

/**
 * `now` counts forward only (`performance.now`), so a wall-clock change can't
 * stretch the claim.
 */
export function createSwipeClaim(
  now: () => number = () => performance.now(),
): SwipeClaim {
  let holding = false;
  let releasedAt = Number.NEGATIVE_INFINITY;
  return {
    begin() {
      holding = false;
      releasedAt = Number.NEGATIVE_INFINITY;
    },
    claim() {
      holding = true;
    },
    release() {
      // Every touch finalizes the pan, a tap included; only one it took over
      // leaves a claim behind.
      if (!holding) return;
      holding = false;
      releasedAt = now();
    },
    isClaimed() {
      return holding || now() - releasedAt < SWIPE_CLAIM_MAX_MS;
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

/** {@link guardedBySwipe} with the enclosing swipe's claim. */
export function useGuardedBySwipe<Args extends unknown[]>(
  handler: ((...args: Args) => void) | null | undefined,
): ((...args: Args) => void) | null | undefined {
  return guardedBySwipe(useSwipeClaim(), handler);
}
