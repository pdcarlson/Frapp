import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import { useBlockedUserIds, type BlockedUserIds } from "@repo/hooks";
import { blockClearance, useBlockClearance } from "./block-clearance";
import {
  applyBlockList,
  contradictedSenders,
  rowsClearedByReadyList,
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
 * 2. Records rows a `ready` list cleared (`block-clearance.ts`), so a later
 *    outage holds only what arrives during it (finding 4).
 * 3. Re-reads the list once per distinct set of senders a ready list is
 *    contradicted on — a masked REST row for someone off the list, which is
 *    what a block made on another device looks like (finding 6). Once per set,
 *    not once per read: a masked copy that outlived an unblock made elsewhere
 *    keeps contradicting the list, and re-reading on every answer would poll.
 *
 * Clearances are passed to the classifier only while the list is not ready.
 * A ready list never consults them, and holding them out keeps `blockState`
 * stable while new rows are recorded, so recording costs no re-classification.
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
    }),
    [blockList.status, blockList.ids, blockList.unblocked, cleared],
  );

  const thread = useMemo(
    () => applyBlockList(messages, blockState, viewerId),
    [messages, blockState, viewerId],
  );

  useEffect(() => {
    if (!isReady || viewerId === null) return;
    blockClearance.record(
      viewerId,
      rowsClearedByReadyList(thread.rows, viewerId),
    );
  }, [isReady, thread.rows, viewerId]);

  const contradicted = useMemo(
    () => contradictedSenders(messages, blockState).join(","),
    [messages, blockState],
  );
  const reconciledFor = useRef("");
  const { retry } = blockList;
  useEffect(() => {
    if (contradicted === "" || contradicted === reconciledFor.current) return;
    reconciledFor.current = contradicted;
    retry();
  }, [contradicted, retry]);

  return { blockList, blockState, thread };
}
