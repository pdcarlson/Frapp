/**
 * Presence status derivation — pure, so the spec's timing rules are provable
 * without a websocket.
 *
 * `spec/behavior/chat/README.md` § Online/offline presence:
 *
 *   - heartbeat ~30 seconds; no heartbeat → offline
 *   - Online, Idle (app open but inactive for >5 minutes), Offline
 *
 * The non-obvious part is that **membership and freshness answer different
 * halves of that**, and conflating them makes Idle unreachable.
 *
 * A heartbeat has to keep re-tracking or Supabase drops the member from the
 * presence map. If each heartbeat stamped `ts = Date.now()`, `ts` would never
 * go stale and every present member would read Online forever — the Idle state
 * would be dead code. So `ts` carries **last user activity** and the heartbeat
 * re-tracks that same unchanged value. Then:
 *
 *   - present, activity within `IDLE_AFTER_MS`  → Online
 *   - present, activity older than that         → Idle   (app open, inactive)
 *   - absent from the presence map              → Offline
 *
 * which is the spec's three states read straight off the two signals.
 */

/** Spec: "Idle (app open but inactive for >5 minutes)". */
export const IDLE_AFTER_MS = 5 * 60 * 1000;

/** Spec: "Presence heartbeat: ~30 seconds." */
export const PRESENCE_HEARTBEAT_MS = 30 * 1000;

export type PresenceStatus = "online" | "idle" | "offline";

/**
 * Status for a member, given the last activity timestamp we hold for them.
 *
 * `null` means "not in the presence map" — the member is not connected at all,
 * which is Offline. That is distinct from a present-but-stale member, who is
 * Idle. Callers must pass `null` rather than `0` for absence; `0` is a real
 * (ancient) timestamp and would read as Idle.
 */
export function presenceStatusFor(
  lastActiveAt: number | null | undefined,
  now: number,
): PresenceStatus {
  if (lastActiveAt === null || lastActiveAt === undefined) return "offline";
  // A clock-skewed peer can stamp `ts` slightly in the future. Treat that as
  // fresh rather than letting a negative age fall through to some other branch.
  return now - lastActiveAt > IDLE_AFTER_MS ? "idle" : "online";
}

/** Human-readable label. Also the accessible name — screen readers get the same words. */
export function presenceLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  return "Offline";
}

/**
 * The shape `RealtimePresenceState` gives us: topic key → list of tracked
 * payloads. Typed structurally rather than imported so this module stays
 * dependency-free and unit-testable.
 */
export type RawPresenceState = Record<string, readonly unknown[]>;

/**
 * Flattens a Supabase presence state into `userId → newest activity ts`.
 *
 * Two things this has to survive, both of which are normal rather than
 * exceptional:
 *
 *   - **One user, several entries.** A member with two tabs open (or a tab
 *     mid-reconnect, where the old and new joins briefly overlap) appears more
 *     than once. Taking the newest `ts` is what makes "active in *any* tab"
 *     read as active, instead of an arbitrary tab winning.
 *   - **Foreign payloads.** The channel is public, so an entry may carry
 *     anything at all. Everything is validated before use and anything
 *     unrecognised is skipped rather than trusted — a malformed entry must not
 *     be able to throw inside a React render pass.
 */
export function presenceMapFrom(state: RawPresenceState): Map<string, number> {
  const byUser = new Map<string, number>();
  for (const entries of Object.values(state ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { userId, ts } = entry as { userId?: unknown; ts?: unknown };
      if (typeof userId !== "string" || userId.length === 0) continue;
      if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
      const previous = byUser.get(userId);
      if (previous === undefined || ts > previous) byUser.set(userId, ts);
    }
  }
  return byUser;
}
