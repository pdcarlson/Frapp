/**
 * What's new opens by itself, once, after an update (#3804;
 * `spec/ui/mobile/screens.md` s16). This file holds the rule and the phone's
 * memory of it; `components/whats-new/whats-new-host.tsx` shows the sheet.
 *
 * The phone remembers the date of the newest entry it has shown
 * ({@link WHATS_NEW_SEEN_STORAGE_KEY}). When the app carries an entry newer
 * than that, the sheet opens over whatever is on screen and the date moves up,
 * so each entry shows once. The notes ship in the JS bundle, so a new entry
 * only ever arrives with a new process (an over-the-air update reloads the
 * bundle; a store update relaunches the app). One check per process is
 * therefore "on launch, and on return after an update" both.
 *
 * Three cases record the newest entry without showing it:
 *
 * - **First launch.** No marker, and the phone held no chat state when this
 *   process started: a fresh install, or a fresh install signed into an
 *   existing account. Old news to them.
 * - **A new member.** The first-run tour is due (`lib/onboarding/tour.ts`),
 *   so this launch belongs to the tour, and what changed before they joined
 *   is not news.
 *
 * And one shows without a marker: **an install from before this existed.** No
 * marker, but chat state on the phone at launch. Without this the build that
 * ships the feature would show nobody anything. It gets the newest entry only;
 * what it saw before is unknown.
 *
 * "Chat state at launch" is read once, at module load, which the root layout
 * triggers ({@link startWhatsNewBootRead}). Read later, a fresh install's own
 * first minutes of chat (read cursors, the last channel) would already be on
 * disk and look like an old install.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReleaseNote } from "@repo/validation";
import { CHAT_KV_PREFIX } from "@/lib/chat/key-value-store";

/** The `date` of the newest entry this phone has shown or skipped. */
export const WHATS_NEW_SEEN_STORAGE_KEY = "frapp.mobile.whats-new-seen";

/**
 * Keys only a phone that has been in a chapter's chat holds: the read cursor
 * per channel, and the last channel per member and chapter
 * (`lastChannelStorageKey` in `@repo/hooks`). Both shipped before this did.
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

export interface WhatsNewDecision {
  /** The entries to show, newest first; empty shows nothing. */
  show: readonly ReleaseNote[];
  /** The date to store as seen, or `null` to leave the marker alone. */
  record: string | null;
}

/**
 * What this launch does. `notes` is `RELEASE_NOTES` (newest first); dates are
 * `YYYY-MM-DD`, so they compare as strings.
 */
export function decideWhatsNew(input: {
  notes: readonly ReleaseNote[];
  seen: string | null;
  tourDue: boolean;
  existingInstall: boolean;
}): WhatsNewDecision {
  const { notes, seen, tourDue, existingInstall } = input;
  const newest = notes[0];
  if (!newest) return { show: [], record: null };
  const upToDate = seen !== null && seen >= newest.date;
  if (upToDate) return { show: [], record: null };
  if (tourDue || (seen === null && !existingInstall)) {
    return { show: [], record: newest.date };
  }
  const show =
    seen === null ? [newest] : notes.filter((note) => note.date > seen);
  return { show, record: newest.date };
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
  date: string,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, date);
  } catch {
    // It shows once more at worst.
  }
}
