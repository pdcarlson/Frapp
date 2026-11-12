import type { QueryClient } from "@tanstack/react-query";
import { taskKeys } from "./use-tasks";

/**
 * A record a chat write creates outside the channel: `/task`, `/hours log`,
 * `/points`, `/event`, and the composer's + menu forms that post the same
 * cards. Chat-core writes them through `apiClient.POST` directly, so the
 * dashboard hooks' own `onSuccess` invalidation never runs for them (#3912).
 */
export type ChatRecordKind = "task" | "hours" | "points" | "event";

/**
 * The dashboard query prefix each kind's page reads, the same prefix the
 * page's own create hook invalidates: `useCreateTask` (`taskKeys.all`),
 * `useCreateServiceEntry` (`["service-entries"]`), `useAdjustPoints`
 * (`["points", chapterId]`) and `useCreateEvent` (`["events", chapterId]`).
 * Unscoped by chapter on purpose: chat-core's result doesn't carry one, and a
 * chapter switch clears the cache anyway.
 */
const RECORD_QUERY_PREFIX: Record<ChatRecordKind, readonly unknown[]> = {
  task: taskKeys.all,
  hours: ["service-entries"],
  points: ["points"],
  event: ["events"],
};

/** The query prefix a chat write of this kind must refresh. */
export function chatRecordQueryKey(kind: ChatRecordKind): readonly unknown[] {
  return RECORD_QUERY_PREFIX[kind];
}

/**
 * Refresh the page a chat write changed. Call it on `ok`, which includes
 * `unconfirmed`: a lost answer may still have committed, and a refetch of a
 * page that didn't change costs one request.
 */
export function invalidateAfterChatWrite(
  queryClient: QueryClient,
  kind: ChatRecordKind,
  result: { ok: boolean },
): void {
  if (!result.ok) return;
  void queryClient.invalidateQueries({ queryKey: RECORD_QUERY_PREFIX[kind] });
}

/** The slash commands whose write lands on a dashboard page. */
export function chatRecordKindForCommand(
  commandName: string,
): ChatRecordKind | null {
  switch (commandName) {
    case "task":
    case "hours":
    case "points":
    case "event":
      return commandName;
    default:
      return null;
  }
}
