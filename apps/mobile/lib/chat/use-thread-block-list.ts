import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import { useBlockedUserIds, type BlockedUserIds } from "@repo/hooks";
import { blockClearance, useBlockClearance } from "./block-clearance";
import {
  applyBlockList,
  contradictingRows,
  rowsToRemember,
  type BlockedThread,
  type BlockState,
} from "./blocks";

const NO_IDS: ReadonlySet<string> = new Set();

export interface ThreadBlockList {
  /** The list hook itself, for the notice's status, retry and spinner. */
  blockList: BlockedUserIds;
  /** What every row and quote in the thread is classified against. */
  blockState: BlockState;
  /** The thread after the list: rendered rows, and how many are held. */
  thread: BlockedThread;
}

/**
 * The s05 thread's block-list plumbing, in one hook so the screen cannot wire
 * half of it (#2257, #2315).
 *
 * 1. Classifies every cached row (`applyBlockList`) against the list, this
 *    client's confirmed changes, and this session's clearances.
 * 2. Records every row a `ready` list shows, and every server-cleared row
 *    shown while it is not ready (`rowsToRemember`, `block-clearance.ts`), so
 *    an outage holds only what first arrives during it (finding 4).
 * 3. Re-reads the list once per distinct set of masked REST rows a ready list
 *    is contradicted by — a masked row for someone off the list, which is what
 *    a block made on another device looks like (finding 6). Once per set, not
 *    once per read: a masked copy that outlived an unblock keeps contradicting
 *    the list, and re-reading on every answer would poll. The set is forgotten
 *    once a ready list stops being contradicted, so the same rows contradicting
 *    it again later — the member blocked again elsewhere — are a new question.
 *
 * Clearances are passed to the classifier only while the list is not ready.
 * A ready list never consults them, and holding them out keeps `blockState`
 * stable while new rows are recorded, so recording costs no re-classification.
 * While the list is not ready a recording does re-classify once, and changes
 * nothing: the rows it adds were already visible, and `record` stays silent
 * when nothing is new, so the effect settles after one pass.
 */
export function useThreadBlockList(
  messages: readonly ChatMessage[],
  viewerId: string | null,
): ThreadBlockList {
  const blockList = useBlockedUserIds();
  const clearance = useBlockClearance(viewerId);
  const isReady = blockList.status === "ready";
  const cleared = isReady ? NO_IDS : clearance;

  const blockState = useMemo<BlockState>(
    () => ({
      status: blockList.status,
      ids: blockList.ids,
      unblocked: blockList.unblocked,
      cleared,
      reading: blockList.isRetrying,
    }),
    [
      blockList.status,
      blockList.ids,
      blockList.unblocked,
      cleared,
      blockList.isRetrying,
    ],
  );

  const thread = useMemo(
    () => applyBlockList(messages, blockState, viewerId),
    [messages, blockState, viewerId],
  );

  useEffect(() => {
    if (viewerId === null) return;
    blockClearance.record(
      viewerId,
      rowsToRemember(thread.rows, viewerId, isReady),
    );
  }, [isReady, thread.rows, viewerId]);

  const contradicted = useMemo(
    () => contradictingRows(messages, blockState).join(","),
    [messages, blockState],
  );
  const reconciledFor = useRef("");
  const { retry } = blockList;
  useEffect(() => {
    if (contradicted === "") {
      // Resolved — but only a ready list can say so. A list that is loading or
      // unavailable reports no contradiction because it proves nothing, and
      // forgetting the set then would re-read on every recovery.
      if (isReady) reconciledFor.current = "";
      return;
    }
    if (contradicted === reconciledFor.current) return;
    reconciledFor.current = contradicted;
    retry();
  }, [contradicted, isReady, retry]);

  return { blockList, blockState, thread };
}
