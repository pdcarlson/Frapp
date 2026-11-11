/**
 * What's new opens by itself on the web dashboard, once, after an update
 * (#3943; `spec/ui/web-dashboard/README.md` § What's new). The rule is
 * `decideWhatsNew` in `@repo/validation`, shared with the phone
 * (`apps/mobile/lib/whats-new.ts`). This file holds what the browser feeds
 * it, the browser's memory of what it showed, and the unread state the
 * account menu's row and the host read; `components/whats-new/whats-new-host.tsx` shows
 * the dialog.
 *
 * The marker is per browser ({@link WHATS_NEW_SEEN_STORAGE_KEY} in
 * `localStorage`), as the phone's is per phone, and the account records the
 * newest entry any device has shown (#4043, `useAccountWhatsNewSeen` in
 * `@repo/hooks`). When the account has seen the entry this browser would open,
 * the browser records it without opening and marks the account menu's row
 * instead ({@link markWhatsNewQuiet}); the mark lasts until What's new is
 * opened here. Offline, the browser's own marker decides, as it did before.
 *
 * A browser can't tell a fresh install from an old one the way a phone can,
 * so "were they here before this entry" is the account's age instead
 * ({@link accountPredatesNote}).
 */

import { useSyncExternalStore } from "react";
import {
  RELEASE_NOTES,
  isLaterReleaseNoteVersion,
  releaseNoteVersion,
  type ReleaseNote,
} from "@repo/validation";

/** `releaseNoteVersion` of the newest entry this browser has shown or skipped. */
export const WHATS_NEW_SEEN_STORAGE_KEY = "frapp.web.whats-new-seen";

/**
 * Set while the account menu's row carries the quiet mark: another device
 * showed the newest entry, and this browser hasn't opened What's new since.
 * Holds that entry's `releaseNoteVersion`.
 */
export const WHATS_NEW_QUIET_STORAGE_KEY = "frapp.web.whats-new-quiet";

export function readWhatsNewSeen(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
  } catch {
    // Storage is blocked. With no marker the newest entry shows at most once
    // per page load to an older account, which is the smaller failure.
    return null;
  }
}

/**
 * Moves the marker up to `version`, never down: a tab still on an older
 * bundle, or a rolled-back deploy, must not undo what a newer one recorded, or
 * the newer entry would open a second time.
 */
function recordWhatsNewSeen(version: string): void {
  if (!isLaterReleaseNoteVersion(version, readWhatsNewSeen())) return;
  try {
    window.localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, version);
  } catch {
    // It shows once more at worst.
  }
}

/**
 * Whether the account existed before `note` reached members: the web's
 * `existingInstall`. An account made on the entry's day or later never saw
 * the app without those changes, so they aren't news. `createdAt` is the
 * account's ISO timestamp; its UTC day is compared with the entry's date, and
 * an account whose age is unknown counts as new (missing one What's new is a
 * smaller failure than greeting a new member with a changelog).
 */
export function accountPredatesNote(
  createdAt: string | null | undefined,
  note: ReleaseNote,
): boolean {
  if (!createdAt) return false;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, 10) < note.date;
}

// ── Unread ──────────────────────────────────────────────────────────────────
// Two marks light the account menu's row. `pending`: the host has found
// entries this browser hasn't shown and hasn't opened them yet (something was
// in the way, or the open delay is running); the host reads it back to know
// there is something to open. `quiet`: another device already showed them
// (#4043), so nothing opens and the row stays marked until What's new is
// opened here, across reloads.

export interface WhatsNewPending {
  /** What the host fed the rule, kept for its open-time check. */
  readonly existingInstall: boolean;
}

let pending: WhatsNewPending | null = null;
let quiet = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setPending(next: WhatsNewPending | null): void {
  if (pending === next) return;
  pending = next;
  notify();
}

function setQuiet(next: boolean): void {
  if (quiet === next) return;
  quiet = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** There are entries this browser hasn't shown: light the account menu's row. */
export function markWhatsNewUnread(existingInstall: boolean): void {
  setPending({ existingInstall });
}

/**
 * Another device showed the notes up to `version`: record it here so they
 * never open by themselves in this browser, and keep the row marked until
 * What's new is opened.
 */
export function markWhatsNewQuiet(version: string): void {
  recordWhatsNewSeen(version);
  try {
    window.localStorage.setItem(WHATS_NEW_QUIET_STORAGE_KEY, version);
  } catch {
    // The mark lasts this page load only.
  }
  setPending(null);
  setQuiet(true);
}

/**
 * Drops the quiet mark without recording anything: the signed-in account
 * hasn't seen the newest entry, so a mark left by another account (a shared
 * browser), or by a rolled-back account version, isn't backed by anything.
 */
export function clearWhatsNewQuiet(): void {
  try {
    window.localStorage.removeItem(WHATS_NEW_QUIET_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  setQuiet(false);
}

/** Brings a quiet mark set on an earlier page load back. */
export function restoreWhatsNewQuiet(): void {
  try {
    if (window.localStorage.getItem(WHATS_NEW_QUIET_STORAGE_KEY) !== null) {
      setQuiet(true);
    }
  } catch {
    // Unreadable storage holds no mark.
  }
}

/**
 * The member has the notes in front of them (the dialog opened, or they went
 * to the What's new page): record the newest entry, clear both marks, and
 * return the version recorded, for the account (`useRecordWhatsNewSeen`).
 */
export function markWhatsNewSeen(): string | null {
  const newest = RELEASE_NOTES[0];
  const version = newest ? releaseNoteVersion(newest) : null;
  if (version) recordWhatsNewSeen(version);
  try {
    window.localStorage.removeItem(WHATS_NEW_QUIET_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  setPending(null);
  setQuiet(false);
  return version;
}

/** The entries were read elsewhere before the host could open them. */
export function clearWhatsNewPending(): void {
  setPending(null);
}

/** Records `version` without the notes having been shown (a new member). */
export function skipWhatsNew(version: string): void {
  recordWhatsNewSeen(version);
  setPending(null);
}

export function useWhatsNewPending(): WhatsNewPending | null {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}

export function useWhatsNewUnread(): boolean {
  const isPending = useWhatsNewPending() !== null;
  const isQuiet = useSyncExternalStore(
    subscribe,
    () => quiet,
    () => false,
  );
  return isPending || isQuiet;
}

/** Test seam: a fresh page load. */
export function resetWhatsNewForTests(): void {
  pending = null;
  quiet = false;
}
