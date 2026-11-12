import {
  parseActivityFilter,
  type ActivityFilter,
} from "@repo/hooks/activity-rows";

/**
 * The Activity page's last chip on this browser, per user (#4402): the page
 * opens on the filter this person left it on. Not on the server, like the
 * Events page's view (`lib/events/events-view.ts`): a phone and a laptop
 * each keep their own.
 *
 * localStorage, best-effort: a private window, blocked site data or a full
 * quota throws or reads empty, and the page then opens on All.
 */
function activityFilterStorageKey(userId: string): string {
  return `frapp.activity.filter.${userId}`;
}

export function readActivityFilter(
  userId: string | null | undefined,
): ActivityFilter | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    return parseActivityFilter(
      window.localStorage.getItem(activityFilterStorageKey(userId)),
    );
  } catch {
    return null;
  }
}

/** Remembers a chip; the To confirm tile's narrowing isn't one, so it's skipped. */
export function writeActivityFilter(
  userId: string | null | undefined,
  filter: ActivityFilter,
): void {
  if (!userId || typeof window === "undefined") return;
  if (parseActivityFilter(filter) === null) return;
  try {
    window.localStorage.setItem(activityFilterStorageKey(userId), filter);
  } catch {
    /* Best-effort: the choice holds for this page's life. */
  }
}
