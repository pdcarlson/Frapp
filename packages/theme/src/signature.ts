/**
 * The shared parts of a signature moment: the once-per-flow animation that
 * marks something the person caused, such as a two-hour Discord import
 * landing (#3493). `spec/ui/design-system/README.md` §7 owns when one may
 * play, its budget and its reduced-motion rule, and lists every moment that
 * ships. Each piece of a moment runs `motion.duration.signature` on
 * `motion.easing.settle` (`./motion.ts`); these are the timings and the
 * curve for the moment as a whole, plain numbers and functions so web and
 * mobile drive them the same way.
 */
export const signatureMoment = {
  /** The whole moment, first frame to rest. Nothing plays past it. */
  totalMs: 1800,
  /** Between one item landing and the next, in a list that lands in turn. */
  staggerMs: 60,
  /** Items in a list that land in turn; the rest arrive with the last. */
  maxStaggered: 8,
  /** A number counting up to its final value. */
  countMs: 1200,
} as const;

/**
 * How far along a settle is, 0 to 1, for a moment `elapsed` ms into one that
 * lasts `duration` ms. An ease-out: fast at first, slow as it lands, so a
 * counter reads its final digits rather than blurring past them.
 */
export function settleProgress(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return 1 - Math.pow(1 - t, 3);
}

/** A number `elapsed` ms into counting up from 0 to `target`, rounded down. */
export function countUpValue(
  target: number,
  elapsed: number,
  duration: number = signatureMoment.countMs,
): number {
  return Math.floor(target * settleProgress(elapsed, duration));
}
