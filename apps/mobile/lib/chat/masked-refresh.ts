import { useSyncExternalStore } from "react";

/**
 * Where each member's post-unblock re-read stands (`refreshMaskedCopies` in
 * `block-actions.ts`), so a stale tombstone can offer a way back when it did
 * not land (#2257 review).
 *
 * After an unblock this client confirmed, a server-masked copy of that
 * member's message stops offering Unblock — there is nothing left to undo —
 * and only the re-read can bring its words back. When that re-read fails for
 * good, a tombstone with no control would strand the copy until the thread
 * happened to reload, with nothing on screen saying anything could be done.
 * Recording the failure is what lets the tombstone offer Reload instead
 * (`BlockedMessageTombstone`).
 *
 * - `refreshing` — a re-read for this member is in flight (retries included).
 * - `failed` — the last one gave up with at least one thread unread.
 * - absent — nothing to report: none ran, or the last one landed.
 *
 * **Scope.** In memory, for the life of the JS runtime, keyed on the member's
 * `users.id`. It needs no chapter or viewer key: it only ever decorates a
 * tombstone the current chapter's list already classified as a stale masked
 * copy, and a Reload re-runs the re-read against whatever the cache holds now.
 *
 * A module-level store read through `useSyncExternalStore`, for the reason
 * `block-clearance.ts` gives: it is read during render.
 */
export type MaskedRefreshState = "refreshing" | "failed";

const NONE: ReadonlyMap<string, MaskedRefreshState> = new Map();

let states: ReadonlyMap<string, MaskedRefreshState> = NONE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const maskedRefresh = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  snapshot(): ReadonlyMap<string, MaskedRefreshState> {
    return states;
  },

  /** Record a member's state; `null` clears it. Notifies only on a change. */
  set(userId: string, state: MaskedRefreshState | null): void {
    if ((states.get(userId) ?? null) === state) return;
    const next = new Map(states);
    if (state === null) next.delete(userId);
    else next.set(userId, state);
    states = next.size === 0 ? NONE : next;
    emit();
  },

  /** Test seam: forget everything. */
  reset(): void {
    states = NONE;
    emit();
  },
};

/** Every member's re-read state, re-rendering when one changes. */
export function useMaskedRefresh(): ReadonlyMap<string, MaskedRefreshState> {
  return useSyncExternalStore(
    maskedRefresh.subscribe,
    maskedRefresh.snapshot,
    maskedRefresh.snapshot,
  );
}
