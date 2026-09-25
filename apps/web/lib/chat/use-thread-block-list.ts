"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  applyBlockList,
  blockClearance,
  contradictingRows,
  maskedRefresh,
  reconcileContradiction,
  rowsToRemember,
  type BlockedThread,
  type BlockState,
  type MaskedRefreshState,
} from "@repo/chat-core/blocks";
import type { ChatMessage } from "@repo/chat-core/types";
import { useBlockedUserIds, type BlockedUserIds } from "@repo/hooks";

const NO_IDS: ReadonlySet<string> = new Set();

export interface ThreadBlockList {
  /** The list hook itself, for the notice's status, retry and spinner. */
  blockList: BlockedUserIds;
  /** What every row, quote and reaction in the thread is classified against. */
  blockState: BlockState;
  /** The thread after the list: rendered rows, and how many are held. */
  thread: BlockedThread;
}

/**
 * The web timeline's block-list plumbing (#2313), in one hook so the shell
 * cannot wire half of it. The same three steps mobile's thread runs, over the
 * same `@repo/chat-core/blocks` rules (`spec/behavior/chat/README.md` § The
 * masking contract):
 *
 * 1. Classifies every cached row (`applyBlockList`) against the list, this
 *    client's confirmed changes, and this session's clearances.
 * 2. Records every row a `ready` list shows, and every server-cleared row
 *    shown while it is not ready (`rowsToRemember`, `blockClearance`), so an
 *    outage holds only what first arrives during it.
 * 3. Re-reads the list once per distinct set of masked REST rows a ready list
 *    is contradicted by (`reconcileContradiction`) — what a block made on
 *    another device looks like until the list is re-read.
 *
 * Clearances are passed to the classifier only while the list is not ready,
 * which keeps `blockState` stable while a ready list's rows are recorded.
 *
 * `viewerId` is `null` while identity is unresolved; the timeline withholds
 * its rows then anyway (#2243), and nothing is recorded without a viewer.
 */
export function useThreadBlockList(
  messages: readonly ChatMessage[],
  viewerId: string | null,
): ThreadBlockList {
  const blockList = useBlockedUserIds();
  const clearance = useSyncExternalStore(
    blockClearance.subscribe,
    () => blockClearance.snapshot(viewerId),
    () => blockClearance.snapshot(viewerId),
  );
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
    const step = reconcileContradiction(
      contradicted,
      isReady,
      reconciledFor.current,
    );
    reconciledFor.current = step.reconciledFor;
    if (step.reread) retry();
  }, [contradicted, isReady, retry]);

  return { blockList, blockState, thread };
}

/**
 * Every member's post-unblock re-read (`maskedRefresh`), re-rendering when one
 * changes. A stale tombstone reads it to offer Reload when the re-read failed.
 */
export function useMaskedRefresh(): ReadonlyMap<string, MaskedRefreshState> {
  return useSyncExternalStore(
    maskedRefresh.subscribe,
    maskedRefresh.snapshot,
    maskedRefresh.snapshot,
  );
}
