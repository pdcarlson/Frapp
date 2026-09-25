import { useSyncExternalStore } from "react";
import { maskedRefresh, type MaskedRefreshState } from "@repo/chat-core/blocks";

/**
 * Every member's post-unblock re-read (`maskedRefresh` in
 * `@repo/chat-core/blocks`), re-rendering when one changes. A stale tombstone
 * reads it to offer Reload when the re-read failed.
 */
export function useMaskedRefresh(): ReadonlyMap<string, MaskedRefreshState> {
  return useSyncExternalStore(
    maskedRefresh.subscribe,
    maskedRefresh.snapshot,
    maskedRefresh.snapshot,
  );
}
