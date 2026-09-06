/**
 * Presence status derivation — pure, so the spec's timing rules are provable
 * without a websocket.
 *
 * `spec/behavior/chat/README.md` § Online/offline presence:
 *
 *   - Online, Idle (app open but inactive for >5 minutes), Offline
 *
 * The non-obvious part is that **membership and freshness answer different
 * halves of that**, and conflating them makes Idle unreachable.
 *
 * If every publish stamped `ts = Date.now()`, `ts` could never age past the
 * threshold and every present member would read Online forever — Idle would be
 * dead code. So `ts` carries **last user activity**, and a re-publish carries
 * that same unchanged value. Then:
 *
 *   - present, activity within `IDLE_AFTER_MS`  → Online
 *   - present, activity older than that         → Idle   (app open, inactive)
 *   - absent from the presence map              → Offline
 *
 * which is the spec's three states read straight off the two signals.
 *
 * **What actually removes a member from the map**, verified against the
 * installed `@supabase/realtime-js` rather than assumed: nothing in
 * `RealtimePresence` or the Phoenix presence adapter has a TTL, expiry or
 * reaper. Presence is *connection-scoped* — an entry goes away when the channel
 * or socket tears down, not when a client stops re-publishing. So there is no
 * liveness heartbeat to maintain, and a periodic re-publish of an unchanged
 * payload would buy nothing while broadcasting a diff to every subscriber. The
 * publish points that matter are the join (and every re-join, which is what
 * restores a member after a drop) and a genuine change in activity.
 */

/** Spec: "Idle (app open but inactive for >5 minutes)". */
export const IDLE_AFTER_MS = 5 * 60 * 1000;

/**
 * The spec's "~30 seconds" cadence.
 *
 * Used for two things, neither of which is a liveness heartbeat (see above):
 * the floor on how often activity may be re-published, and the local tick that
 * lets a member cross into Idle without any network event. Both are resolution
 * knobs against a five-minute threshold.
 */
export const PRESENCE_HEARTBEAT_MS = 30 * 1000;

export type PresenceStatus = "online" | "idle" | "offline";

/**
 * Status for a member, given the last activity timestamp we hold for them.
 *
 * `null` means "not in the presence map" — not connected at all, which is
 * Offline. That is distinct from a present-but-stale member, who is Idle.
 * Callers must pass `null` rather than `0` for absence; `0` is a real (ancient)
 * timestamp and would read as Idle.
 */
export function presenceStatusFor(
  lastActiveAt: number | null | undefined,
  now: number,
): PresenceStatus {
  if (lastActiveAt === null || lastActiveAt === undefined) return "offline";
  // A clock-skewed peer can stamp `ts` slightly in the future. Treat that as
  // fresh rather than letting a negative age fall through to another branch.
  return now - lastActiveAt > IDLE_AFTER_MS ? "idle" : "online";
}

/** Human-readable label. Also the accessible name — screen readers get these words. */
export function presenceLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  return "Offline";
}

/**
 * The dot treatment for a status — the colour decision, in a named mapper
 * rather than inline in JSX.
 *
 * This repo keeps one mapper per domain status vocabulary (`poll-status.ts`,
 * `settings-status.ts`, and friends) because the shared invariant is that **no
 * domain status is ever painted in the chapter accent** — #1202 found five that
 * were, and the ones that had no mapper were the ones nobody could check.
 * Presence is a vocabulary like the rest, so its colours live here where
 * `presence-status.spec.ts` can assert the invariant over every arm.
 *
 * Idle is a ring rather than a fill, so Online and Idle differ in **shape** as
 * well as colour — `--success` and `--warning` are a green/amber pair, which is
 * the classic pair colour-vision deficiency collapses. The ring's interior is
 * `bg-card`, not `bg-transparent`: the dot sits on an avatar, and a transparent
 * interior lets the photo show through, so an amber-ish photo would make Idle
 * read as a filled dot — losing the shape distinction exactly when the colour
 * one is also weakest.
 */
export function presenceStatusKind(status: PresenceStatus): string {
  if (status === "online") return "bg-success";
  if (status === "idle") return "border-2 border-warning bg-card";
  return "bg-muted-foreground/40";
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
 * Two things this has to survive, both normal rather than exceptional:
 *
 *   - **One user, several entries.** A member with two tabs open (or one tab
 *     mid-reconnect, where the old and new joins briefly overlap) appears more
 *     than once. Taking the newest `ts` makes "active in *any* tab" read as
 *     active, rather than an arbitrary tab winning.
 *   - **Foreign payloads.** The channel is public, so an entry may carry
 *     anything. Everything is validated before use and anything unrecognised is
 *     skipped rather than trusted — a malformed entry must not be able to throw
 *     inside a React render pass.
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

/**
 * Do two rosters say the same thing?
 *
 * Presence diffs are broadcast to every subscriber, and a member re-publishing
 * their activity produces one whose reduced result is usually identical. Without
 * this check each of those would swap in a structurally equal `Map`, changing
 * identity and re-rendering the whole directory — every row, the sort, the
 * search box — to put nothing new on screen.
 */
export function sameRoster(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [userId, ts] of a) {
    if (b.get(userId) !== ts) return false;
  }
  return true;
}
