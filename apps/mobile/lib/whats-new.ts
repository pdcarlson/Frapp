/**
 * What's new opens by itself, once, after an update (#3804;
 * `spec/ui/mobile/screens.md` s16). This file holds the phone's memory of it
 * and what the phone feeds the rule, `decideWhatsNew` in `@repo/validation`,
 * which the web dashboard shares; `components/whats-new/whats-new-host.tsx`
 * shows the sheet.
 *
 * The phone remembers which version of the newest entry it has shown
 * ({@link WHATS_NEW_SEEN_STORAGE_KEY}, holding `releaseNoteVersion` from
 * `@repo/validation`: the entry's date and how many lines it had). When the
 * app carries a newer entry, or the same day's entry with lines added since (a
 * second release on one day extends that day's entry, because dates are
 * unique), the sheet opens over whatever is on screen and the marker moves up,
 * so each version shows once. Rewording a line isn't news and shows nothing,
 * and neither does a rollback to a shorter version of the same entry. The
 * notes ship in the JS bundle, so a new entry only ever arrives with a new
 * process (an over-the-air update reloads the bundle; a store update relaunches
 * the app). One check per process is therefore "on launch, and on return after
 * an update" both.
 *
 * Two cases record the newest entry without showing it:
 *
 * - **First launch.** No marker, and the phone held no chat state when this
 *   process started: a fresh install, or a fresh install signed into an
 *   existing account. Old news to them.
 * - **A new member.** The first-run tour is due (`lib/onboarding/tour.ts`),
 *   so this launch belongs to the tour, and what changed before they joined
 *   is not news.
 *
 * And one case shows without a marker: **an install from before this
 * existed.** No marker, but chat state on the phone at launch. Without it the
 * build that ships the feature would show nobody anything. It gets the newest
 * entry only; what it saw before is unknown.
 *
 * "Chat state at launch" is read once, at module load, which the root layout
 * triggers ({@link startWhatsNewBootRead}). Read later, a fresh install's own
 * first minutes of chat (read cursors, the last channel) would already be on
 * disk and look like an old install.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHAT_KV_PREFIX } from "@/lib/chat/key-value-store";

/** `releaseNoteVersion` of the newest entry this phone has shown or skipped. */
export const WHATS_NEW_SEEN_STORAGE_KEY = "frapp.mobile.whats-new-seen";

/**
 * Keys only a phone that has been in a chapter's chat holds: the read cursor
 * per channel, and the last channel per member and chapter
 * (`lastChannelStorageKey` in `@repo/hooks`). Both shipped before this did.
 *
 * The last-channel prefix is spelled out rather than derived from
 * `lastChannelStorageKey` on purpose: it has to match the keys builds from
 * before this feature already wrote to disk, whatever shape that helper takes
 * later. Once a phone has a marker, these prefixes are never read again.
 */
export const EXISTING_INSTALL_KEY_PREFIXES: readonly string[] = [
  CHAT_KV_PREFIX,
  "frapp.chat.last-channel.",
];

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;
type KeyLister = Pick<typeof AsyncStorage, "getAllKeys">;

export function hasExistingInstallKey(keys: readonly string[]): boolean {
  return keys.some((key) =>
    EXISTING_INSTALL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

let bootRead: Promise<boolean> | null = null;

/**
 * Starts the one read of what the phone held at launch, if it hasn't started.
 * The root layout calls it at module load; the host awaits the same promise.
 * A failed read counts as a fresh install: missing one What's new is a far
 * smaller failure than showing it on someone's first launch.
 */
export function startWhatsNewBootRead(
  storage: KeyLister = AsyncStorage,
): Promise<boolean> {
  if (!bootRead) {
    bootRead = storage
      .getAllKeys()
      .then((keys) => hasExistingInstallKey(keys))
      .catch(() => false);
  }
  return bootRead;
}

/** Test seam: a fresh process. */
export function resetWhatsNewBootReadForTests(): void {
  bootRead = null;
}

export async function readWhatsNewSeen(
  storage: Storage = AsyncStorage,
): Promise<string | null> {
  try {
    return await storage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
  } catch {
    // Unreadable reads as an old install with no marker, which shows the
    // newest entry at most once more.
    return null;
  }
}

export async function recordWhatsNewSeen(
  id: string,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, id);
  } catch {
    // It shows once more at worst.
  }
}
