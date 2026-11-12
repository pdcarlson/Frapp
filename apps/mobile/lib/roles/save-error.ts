import { errorCopy } from "@repo/hooks/error-copy";

/**
 * The line a failed permission save leaves on a Roles screen (#4074). The
 * phone has no toast, so the screen keeps it at the top until the next save,
 * and the switch has already snapped back to the truth. The role routes write
 * their refusals for the officer (the rank rules, #4071: "This role ranks at
 * or above yours"), so those read in their own words; anything else gets the
 * app's shared copy (`errorCopy`).
 */
export function describeError(holderName: string, error: unknown): string {
  const reason = errorCopy(
    error,
    "The permission was not changed. Try again in a moment.",
    { serverWritesForMembers: true },
  );
  return `Couldn't update ${holderName}. ${reason}`;
}
