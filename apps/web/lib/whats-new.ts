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
 * `localStorage`), as the phone's is per phone. Nothing on the account says
 * which entry a member has read, so an entry read on the phone shows once
 * more on the web (#3943 names the choice).
 *
 * A browser can't tell a fresh install from an old one the way a phone can,
 * so "were they here before this entry" is the account's age instead
 * ({@link accountPredatesNote}).
 */

import { useSyncExternalStore } from "react";
import {
  RELEASE_NOTES,
  releaseNoteVersion,
  type ReleaseNote,
} from "@repo/validation";

/** `releaseNoteVersion` of the newest entry this browser has shown or skipped. */
export const WHATS_NEW_SEEN_STORAGE_KEY = "frapp.web.whats-new-seen";

export function readWhatsNewSeen(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
  } catch {
    // Storage is blocked. With no marker the newest entry shows at most once
    // per page load to an older account, which is the smaller failure.
    return null;
  }
}

function recordWhatsNewSeen(version: string): void {
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
// Set while the host has found entries this browser hasn't shown and hasn't
// opened them yet (something was in the way, or the open delay is running).
// The account menu's row carries a mark meanwhile, and the host reads it back
// to know there is something to open.

export interface WhatsNewPending {
  /** What the host fed the rule, kept for its open-time check. */
  readonly existingInstall: boolean;
}

let pending: WhatsNewPending | null = null;
const listeners = new Set<() => void>();

function setPending(next: WhatsNewPending | null): void {
  if (pending === next) return;
  pending = next;
  for (const listener of listeners) listener();
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
 * The member has the notes in front of them (the dialog opened, or they went
 * to the What's new page): record the newest entry and clear the mark.
 */
export function markWhatsNewSeen(): void {
  const newest = RELEASE_NOTES[0];
  if (newest) recordWhatsNewSeen(releaseNoteVersion(newest));
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
  return useWhatsNewPending() !== null;
}

/** Test seam: a fresh page load. */
export function resetWhatsNewForTests(): void {
  pending = null;
}
