import { useSyncExternalStore } from "react";
import { blockClearance } from "@repo/chat-core/blocks";

/**
 * The viewer's clearances (`blockClearance` in `@repo/chat-core/blocks`, which
 * says what they are and why), re-rendering when new ones are recorded.
 */
export function useBlockClearance(
  viewerId: string | null,
): ReadonlySet<string> {
  return useSyncExternalStore(
    blockClearance.subscribe,
    () => blockClearance.snapshot(viewerId),
    () => blockClearance.snapshot(viewerId),
  );
}
