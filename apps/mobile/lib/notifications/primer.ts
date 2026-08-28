/**
 * Whether to offer the push opt-in primer, and what the member last said.
 *
 * `spec/ui/mobile/patterns.md` § Push notifications: "The opt-in primer appears
 * at the first moment push has obvious value — first RSVP or first chat open —
 * and on the first-run screen (s03) as a card, never as a cold launch-time OS
 * prompt. Declining is a quiet 'Not now'; the OS prompt fires only after the
 * user accepts the primer."
 *
 * Two rules fall out of that, and both are why this module exists rather than a
 * boolean in a screen:
 *
 * - **The OS prompt is downstream of the card.** iOS gives an app exactly one
 *   permission dialog ever; spending it on a cold launch is unrecoverable. So
 *   nothing calls `requestPushPermission()` except the card's "Turn on".
 * - **"Not now" has to stick.** A primer that reappears on every launch is the
 *   nag the contextual pattern exists to avoid, so the decision is persisted.
 *   It is deliberately *not* permanent: s16 Settings still routes to the OS
 *   settings, which is where a member who changes their mind goes.
 *
 * The same reasoning already shipped for location in
 * `components/study/location-primer-sheet.tsx` (s10) — this is its push sibling.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const PUSH_PRIMER_STORAGE_KEY = "frapp.mobile.push-primer";

/** `"unasked"` is the absence of a stored decision, not a stored value. */
export type PrimerDecision = "unasked" | "declined" | "accepted";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export function parsePrimerDecision(value: unknown): PrimerDecision {
  return value === "declined" || value === "accepted" ? value : "unasked";
}

export async function readPrimerDecision(
  storage: Storage = AsyncStorage,
): Promise<PrimerDecision> {
  try {
    return parsePrimerDecision(await storage.getItem(PUSH_PRIMER_STORAGE_KEY));
  } catch {
    // Unknown reads as unasked: offering a primer one extra time is a far
    // smaller failure than never offering it at all.
    return "unasked";
  }
}

export async function recordPrimerDecision(
  decision: Exclude<PrimerDecision, "unasked">,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(PUSH_PRIMER_STORAGE_KEY, decision);
  } catch {
    // Cosmetic. The worst case is the primer offering itself again.
  }
}

export interface PrimerVisibilityInput {
  /** `isPushAvailable()` — the module loaded and a project id is configured. */
  isAvailable: boolean;
  /** OS permission already granted. `null` while the read is in flight. */
  permissionGranted: boolean | null;
  decision: PrimerDecision;
}

/**
 * Whether the primer card has anything to offer.
 *
 * Hidden once permission is granted (there is nothing left to ask), and once
 * the member has declined (that was an answer, not a deferral).
 *
 * It stays **visible when push is unavailable**, explaining why instead of
 * disappearing — `spec/ui/design-system/components.md` §5's rule for a control
 * that cannot act. That case is not hypothetical: it is the state of every
 * build until #938 provisions an EAS project. Permission cannot be read at all
 * without the native module, so `permissionGranted` stays `null` there and the
 * availability check has to come first.
 */
export function shouldOfferPrimer({
  isAvailable,
  permissionGranted,
  decision,
}: PrimerVisibilityInput): boolean {
  if (decision !== "unasked") return false;
  // Unavailable: no permission to read, and the card's job is to say so.
  if (!isAvailable) return true;
  // Available but not yet read — do not flash a card that may be about to
  // resolve to "already granted".
  if (permissionGranted === null) return false;
  return !permissionGranted;
}
