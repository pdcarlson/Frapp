/**
 * The connection state machine from `spec/ui/resilience/connection-state.md`, as pure
 * functions.
 *
 * Shared by web (`NetworkProvider`) and mobile (`lib/connection`) so the two
 * surfaces cannot disagree about when a member is ONLINE, DEGRADED, or
 * OFFLINE. Everything here is synchronous and dependency-free; each app owns
 * the effects that feed it (browser `navigator.onLine` + `/health` poll on
 * web; `expo-network` + the same poll on mobile).
 *
 * ## Two inputs, not one
 *
 * A device link is not reachability. `navigator.onLine` / `expo-network`
 * answer "is there a link". They do not catch an API that is up, routable,
 * and failing. That is what the `/health` probe is for, and why `DEGRADED`
 * exists at all: the member is connected, the app is not working properly,
 * and saying "you're offline" would be a lie they can disprove by opening a
 * browser.
 *
 * ## 429 is reachability, not an outage
 *
 * `/health` is unauthenticated and IP-keyed. A chapter house behind one NAT
 * can 429 the anonymous bucket while authenticated `/v1` traffic still
 * succeeds. Counting that as a probe failure would take the whole house
 * OFFLINE. A 429 proves the API process is up and throttling, so it resets
 * the failure count the same way a 2xx does.
 *
 * ## What this does not model
 *
 * DEGRADED's "slow (>5s)" half in Detection Logic is unbuilt on both surfaces. Consecutive
 * probe failures are the only DEGRADED input. Do not "fix" that here by
 * inventing a duration signal the apps do not collect.
 */

/** `spec/ui/resilience/connection-state.md`. The names are the spec's, uppercase and all. */
export type ConnectionState = "ONLINE" | "DEGRADED" | "OFFLINE";

/**
 * Consecutive failed health probes before the app calls itself offline.
 *
 * Three: a single timeout on a train is not an outage, and flapping the
 * banner on every one would train members to ignore it.
 */
export const DEGRADED_THRESHOLD = 3;

export interface ConnectionInput {
  /** No link: `!navigator.onLine` on web, `isConnected === false` on mobile. */
  linkOffline: boolean;
  /** Consecutive `/health` failures; reset to 0 by any reachable probe. */
  consecutiveFailures: number;
}

export function deriveConnectionState({
  linkOffline,
  consecutiveFailures,
}: ConnectionInput): ConnectionState {
  // No link is unambiguous and needs no corroboration — probing would only
  // delay the banner by up to a poll interval to reach the same answer.
  if (linkOffline) return "OFFLINE";
  if (consecutiveFailures >= DEGRADED_THRESHOLD) return "OFFLINE";
  if (consecutiveFailures > 0) return "DEGRADED";
  return "ONLINE";
}

/**
 * Did this `/health` response prove the API is reachable?
 *
 * `ok` covers 2xx. 429 is called out because it is the one non-2xx that still
 * proves the process is up — see the file doc. A mock that only sets `ok`
 * (mobile's monitor specs) still works: missing `status` is not 429.
 */
export function healthProbeIsReachable(response: {
  ok: boolean;
  status?: number;
}): boolean {
  if (response.status === 429) return true;
  return response.ok;
}
