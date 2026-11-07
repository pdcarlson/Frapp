import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeTransportStatus } from "@repo/validation";

/**
 * The realtime transport of the chat that is open right now, or `null` when
 * no chat is.
 *
 * The open chat reports it here, and the one connection indicator reads it
 * (`connectionIndicator` in `@repo/validation`,
 * `spec/ui/resilience/connection-state.md` § One indicator). That is what lets a
 * chat stop drawing its own transport pill beside the app-wide one: it hands
 * its status to the indicator that is already on screen, which decides whether
 * the transport or the app connection is the thing worth saying.
 *
 * A module store rather than a context, because the reporter (a chat screen)
 * sits deep inside the tree and the reader (the app-wide indicator) sits
 * above it, or beside it in a portal, on both surfaces.
 */

let current: RealtimeTransportStatus | null = null;
const listeners = new Set<() => void>();

function publish(next: RealtimeTransportStatus | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): RealtimeTransportStatus | null {
  return current;
}

/** Read the open chat's transport status; `null` when no chat is open. */
export function useOpenChatTransport(): RealtimeTransportStatus | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/**
 * Report this chat's transport status while the caller is mounted, and clear
 * it on unmount. Pass `null` while the chat has no channel yet.
 */
export function useReportOpenChatTransport(
  status: RealtimeTransportStatus | null,
): void {
  useEffect(() => {
    publish(status);
  }, [status]);
  useEffect(() => () => publish(null), []);
}

/** Test seam: reset the store between specs. */
export function resetOpenChatTransportForTests(): void {
  publish(null);
}
