import type { QueryClient } from "@tanstack/react-query";
import { taskKeys } from "./use-tasks";

/**
 * The dashboard query prefix each chat-written record's page reads, the same
 * prefix the page's own create hook invalidates: `useCreateTask`
 * (`taskKeys.all`), `useCreateServiceEntry` (`["service-entries"]`) and
 * `useAdjustPoints` (`invalidatePointReads`, `["points"]`). Unscoped by chapter on purpose:
 * chat-core's result doesn't carry one, and a chapter switch clears the cache
 * anyway.
 *
 * `/task`, `/hours log`, `/points` and the composer's + menu forms write
 * through chat-core's `apiClient.POST`, so those hooks' `onSuccess` never runs
 * for them and the page beside chat kept its old list (#3912). `/event` is
 * left out: the Events page already refetches on every `events` insert over
 * Realtime (`useRealtimeTable` in `events-page.tsx`). `/rush` is too: web has
 * no candidate list to go stale, only per-card detail queries.
 */
const RECORD_QUERY_PREFIX = {
  task: taskKeys.all,
  hours: ["service-entries"],
  points: ["points"],
} as const satisfies Record<string, readonly unknown[]>;

export type ChatRecordKind = keyof typeof RECORD_QUERY_PREFIX;

/** The kind a slash command writes, or `null` when no page reads it. */
export function chatRecordKindForCommand(
  commandName: string,
): ChatRecordKind | null {
  return Object.hasOwn(RECORD_QUERY_PREFIX, commandName)
    ? (commandName as ChatRecordKind)
    : null;
}

/**
 * Run a chat write and refresh the page it lands on. It refreshes on `ok`,
 * which includes `unconfirmed` (a lost answer may still have committed), and
 * when the write throws, since chat-core's bookkeeping can fail after the
 * request went out and the shell reads that as unconfirmed too. A definite
 * refusal refreshes nothing. A refetch of a page that didn't change costs one
 * request.
 */
export async function withChatRecordRefresh<T extends { ok: boolean }>(
  queryClient: QueryClient,
  kind: ChatRecordKind | null,
  write: () => Promise<T>,
): Promise<T> {
  const refresh = () => {
    if (kind) {
      void queryClient.invalidateQueries({
        queryKey: RECORD_QUERY_PREFIX[kind],
      });
    }
  };
  let result: T;
  try {
    result = await write();
  } catch (error) {
    refresh();
    throw error;
  }
  if (result.ok) refresh();
  return result;
}
