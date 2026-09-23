import { useSyncExternalStore } from "react";

/**
 * Messages this session has already shown against a `ready` block list, or
 * that the server cleared (#2257 review, finding 4).
 *
 * A row that arrived over the Realtime echo is never server-evaluated, and it
 * never will be: the reconnect backfill and the polling fallback read only rows
 * after the last-seen cursor, and every echo advances that cursor. A row read
 * over REST loses its evaluation the same way the moment an UPDATE echo of it —
 * a pin, an edit, a soft delete — is merged over it. So without a memory, a
 * later block-list outage would flip messages the viewer had already read back
 * to held — a conversation vanishing mid-read. Recording every row a ready list
 * showed, and every server-cleared row shown while it was not
 * (`rowsToRemember`), keeps what was legitimately seen on screen, while an
 * unevaluated row that first arrives *during* an outage is still held
 * (`classifyMessage` in `blocks.ts`).
 *
 * What it does not do: override a block. The list is consulted before this, so
 * a member blocked since — here, or on another device once the list re-reads —
 * is tombstoned whatever this remembers.
 *
 * **Scope.** In memory, for the life of the JS runtime, and keyed on the
 * viewer's `users.id`: a different viewer starts empty. Chapters need no key of
 * their own, because message ids are globally unique and a row from one
 * chapter never renders in another.
 *
 * A module-level store read through `useSyncExternalStore` rather than a ref,
 * because it is read during render, and reading a ref there is exactly what
 * `react-hooks/refs` forbids — and what a compiled component may memoize past.
 */

const NO_IDS: ReadonlySet<string> = new Set();

let scope: string | null = null;
let cleared: ReadonlySet<string> = NO_IDS;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const blockClearance = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** The ids recorded for this viewer; empty for anyone else. */
  snapshot(viewerId: string | null): ReadonlySet<string> {
    return viewerId !== null && viewerId === scope ? cleared : NO_IDS;
  },

  /**
   * Remember message ids this viewer has been shown (`rowsToRemember`). A different
   * viewer than the last one recorded for starts a fresh set. Notifies only
   * when something new was added.
   */
  record(viewerId: string, messageIds: readonly string[]): void {
    if (scope !== viewerId) {
      scope = viewerId;
      cleared = NO_IDS;
    }
    const added = messageIds.filter((id) => !cleared.has(id));
    if (added.length === 0) return;
    const next = new Set(cleared);
    for (const id of added) next.add(id);
    cleared = next;
    emit();
  },

  /** Test seam: forget everything. */
  reset(): void {
    scope = null;
    cleared = NO_IDS;
    emit();
  },
};

/** The viewer's clearances, re-rendering when new ones are recorded. */
export function useBlockClearance(
  viewerId: string | null,
): ReadonlySet<string> {
  return useSyncExternalStore(
    blockClearance.subscribe,
    () => blockClearance.snapshot(viewerId),
    () => blockClearance.snapshot(viewerId),
  );
}
