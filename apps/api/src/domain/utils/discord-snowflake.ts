/**
 * Discord ids and time (#2858).
 *
 * A Discord snowflake carries the millisecond it was minted, counted from
 * Discord's epoch, in its bits above 22. So an instant maps to the smallest
 * id Discord could have minted at it, and comparing ids compares when the
 * messages were sent, with no timestamp field to parse.
 */

/** 2015-01-01T00:00:00Z, the zero of every Discord snowflake. */
export const DISCORD_EPOCH_MS = 1_420_070_400_000;

/**
 * The smallest snowflake minted at or after `ms`: every message sent at or
 * after that instant has an id at least this. Zero before Discord's epoch.
 */
export function snowflakeAtOrAfter(ms: number): bigint {
  if (!Number.isFinite(ms) || ms <= DISCORD_EPOCH_MS) return 0n;
  return (BigInt(Math.floor(ms)) - BigInt(DISCORD_EPOCH_MS)) << 22n;
}

/**
 * Whether a message id was minted at or after `cutoff`. An id that is not a
 * snowflake counts as newer, so the batch writer, which already drops a
 * message it cannot place, is what decides about it.
 */
export function isAtOrAfter(id: unknown, cutoff: bigint): boolean {
  if (typeof id !== 'string' || !/^\d+$/.test(id)) return true;
  return BigInt(id) >= cutoff;
}
