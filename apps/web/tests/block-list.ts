import { applyBlockList, type BlockState } from "@repo/chat-core/blocks";
import type { ChatMessage } from "@repo/chat-core/types";

/**
 * Block-list fixtures for specs that render the timeline or a row
 * (`MessageTimeline`, `MessageItem`), which require the viewer's classified
 * block list since #2313.
 *
 * `blockState` builds one from plain arrays; `NOBODY_BLOCKED` is a ready list
 * naming no one — what a spec about something other than blocking wants.
 */
export function blockState(
  status: BlockState["status"] = "ready",
  {
    ids = [],
    unblocked = [],
    cleared = [],
  }: { ids?: string[]; unblocked?: string[]; cleared?: string[] } = {},
): BlockState {
  return {
    status,
    ids: new Set(ids),
    unblocked: new Set(unblocked),
    cleared: new Set(cleared),
  };
}

export const NOBODY_BLOCKED: BlockState = blockState();

/**
 * The props `MessageTimeline` takes for its block list: the thread classified
 * against `state` (a ready list naming nobody by default), with inert handlers
 * unless a spec passes its own.
 */
export function timelineBlockProps(
  messages: readonly ChatMessage[],
  viewerId: string | null,
  state: BlockState = NOBODY_BLOCKED,
) {
  return {
    blockList: {
      blockState: state,
      thread: applyBlockList(messages, state, viewerId),
    },
    onUnblock: () => {},
    onReloadMasked: () => {},
    maskedRefresh: new Map(),
  };
}
