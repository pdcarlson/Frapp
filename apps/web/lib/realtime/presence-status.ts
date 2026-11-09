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
 * which is the spec's three states read straight off the two signals. A
 * status the member picked (#3845) rides the same entry and beats the clock;
 * see `presenceStatusFor`.
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

import {
  CUSTOM_STATUS_MAX,
  MEMBER_STATUS_LABEL,
} from "@repo/hooks/member-status";

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

/**
 * What a dot can say.
 *
 * `dnd` and a picked `idle` come from the member's own choice (#3845), carried
 * on their chapter presence entry. `invisible` is never read off the wire: an
 * invisible member publishes nothing, so everyone else sees them Offline, and
 * only the member's own client says `invisible`, about themselves.
 */
export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

/**
 * The status a member picked that rides their presence entry. Online is the
 * absence of one, and Invisible never rides at all (it publishes nothing).
 */
export type PickedPresence = "idle" | "dnd";

/** One member's entry on `presence:chapter:<id>`, as far as we trust it. */
export type PresenceEntry = {
  /** Last user activity, not last publish (see the module header). */
  ts: number;
  /** A picked Idle or DND, or `null` for automatic. */
  picked: PickedPresence | null;
  /** The custom status line, or `null` for none. */
  line: string | null;
};


/**
 * Status for a member, given the presence entry we hold for them.
 *
 * `null` means "not in the presence map": not connected at all, or invisible,
 * which is Offline. That is distinct from a present-but-stale member, who is
 * Idle. A picked status beats the clock: DND stays DND while the member is
 * away, and a picked Idle stays Idle while they type.
 */
export function presenceStatusFor(
  entry: PresenceEntry | null | undefined,
  now: number,
): PresenceStatus {
  if (entry === null || entry === undefined) return "offline";
  if (entry.picked) return entry.picked;
  // A clock-skewed peer can stamp `ts` slightly in the future. Treat that as
  // fresh rather than letting a negative age fall through to another branch.
  return now - entry.ts > IDLE_AFTER_MS ? "idle" : "online";
}


/** Human-readable label. Also the accessible name — screen readers get these words. */
export function presenceLabel(status: PresenceStatus): string {
  return status === "offline" ? "Offline" : MEMBER_STATUS_LABEL[status];
}

/**
 * The dot treatment for a status — the colour decision, in a named mapper
 * rather than inline in JSX.
 *
 * This repo keeps one mapper per domain status vocabulary (`geofence-status.ts`,
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
 *
 * DND (#3845) is a `--destructive` fill with a dark bar across it, which
 * `AvatarPresenceDot` draws as a child, so it differs from Online by shape as
 * well (red/green is the other pair colour-vision deficiency collapses).
 * Invisible is a grey ring, the Idle recipe in `--muted-foreground`, so it
 * reads apart from Offline's faint grey fill, and only the member themselves
 * ever sees it.
 */
export function presenceStatusKind(status: PresenceStatus): string {
  if (status === "online") return "bg-success";
  if (status === "idle") return "border-2 border-warning bg-card";
  if (status === "dnd") return "bg-destructive";
  if (status === "invisible") return "border-2 border-muted-foreground bg-card";
  return "bg-muted-foreground/40";
}

/**
 * The shape `RealtimePresenceState` gives us: topic key → list of tracked
 * payloads. Typed structurally rather than imported so this module stays
 * dependency-free and unit-testable.
 */
export type RawPresenceState = Record<string, readonly unknown[]>;

/**
 * A custom line from a peer's payload, made safe to render: one line, at most
 * `CUSTOM_STATUS_MAX` code points. The API holds the member's own line to the
 * same rules, but the payload is whatever their client published, so it is
 * re-checked here rather than trusted.
 */
export function presenceLineFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters and the Unicode line and paragraph separators become
  // spaces, so a crafted payload cannot break the row it renders in.
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim();
  if (flat.length === 0) return null;
  return Array.from(flat).slice(0, CUSTOM_STATUS_MAX).join("");
}

function pickedFrom(value: unknown): PickedPresence | null {
  return value === "idle" || value === "dnd" ? value : null;
}

/**
 * Flattens a Supabase presence state into `userId → entry`.
 *
 * Two things this has to survive, both normal rather than exceptional:
 *
 *   - **One user, several entries.** A member with two tabs open (or one tab
 *     mid-reconnect, where the old and new joins briefly overlap) appears more
 *     than once. The entry with the newest `ts` wins, so "active in *any* tab"
 *     reads as active rather than an arbitrary tab winning, and its picked
 *     status and line come with it.
 *   - **Foreign payloads.** The channel is shared by the chapter, so an entry
 *     may carry anything. Everything is validated before use and anything
 *     unrecognised is skipped rather than trusted — a malformed entry must not
 *     be able to throw inside a React render pass. An unknown `status` reads as
 *     automatic, and a malformed `line` as none. What this can't check is
 *     who published an entry: see the chat spec on forged entries.
 */
export function presenceMapFrom(
  state: RawPresenceState,
): Map<string, PresenceEntry> {
  const byUser = new Map<string, PresenceEntry>();
  for (const entries of Object.values(state ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { userId, ts, status, line } = entry as {
        userId?: unknown;
        ts?: unknown;
        status?: unknown;
        line?: unknown;
      };
      if (typeof userId !== "string" || userId.length === 0) continue;
      if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
      const previous = byUser.get(userId);
      if (previous === undefined || ts > previous.ts) {
        byUser.set(userId, {
          ts,
          picked: pickedFrom(status),
          line: presenceLineFrom(line),
        });
      }
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
  a: Map<string, PresenceEntry>,
  b: Map<string, PresenceEntry>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [userId, entry] of a) {
    const other = b.get(userId);
    if (
      !other ||
      other.ts !== entry.ts ||
      other.picked !== entry.picked ||
      other.line !== entry.line
    ) {
      return false;
    }
  }
  return true;
}
