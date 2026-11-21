import { useCallback, useEffect, useRef } from "react";

/** The two scroll calls the jump needs, as a `FlatList` provides them. */
export interface JumpableList {
  scrollToIndex(params: {
    index: number;
    animated?: boolean;
    viewPosition?: number;
    viewOffset?: number;
  }): void;
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

/** Where in the list a jump puts its row (`scrollToIndex`'s terms). */
export interface JumpPlacement {
  viewPosition: number;
  viewOffset?: number;
}

const MIDDLE: JumpPlacement = { viewPosition: 0.5 };

/** How long the fallback waits for rows near the target to render. */
export const JUMP_RETRY_MS = 100;

/**
 * A reply quote's tap scrolls the s05 thread to its parent (#2775), when the
 * parent is a row in the list.
 *
 * Rows have no fixed height, so a target outside the rendered window fails
 * `scrollToIndex` once. The fallback scrolls near it by the average row height
 * and tries once more. That retry looks the message up again when it fires,
 * in the rows on screen then, rather than reusing the failed index: the rows
 * can change under a pending retry, and `scrollToIndex` throws (it does not
 * fail) on an index past the end of a shorter list, inside a timer where
 * nothing catches it. A channel switch (`resetKey`), which also gives the
 * thread a fresh list, or unmount cancels a pending retry.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested.
 */
export function useJumpToMessage<L extends JumpableList>(
  rows: readonly { message: { id: string } }[],
  resetKey: string | null,
) {
  const listRef = useRef<L>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const targetRef = useRef<string | null>(null);
  // Where the jump puts the row: the middle by default. The message menu
  // (#5479) brings a row to the bottom (0) or top (1) of an inverted list,
  // offset past what its cell draws under the message.
  const placeRef = useRef<JumpPlacement>(MIDDLE);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRetry = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
  }, []);
  useEffect(() => cancelRetry, [resetKey, cancelRetry]);

  const indexOf = (messageId: string) =>
    rowsRef.current.findIndex((row) => row.message.id === messageId);

  const jumpToMessage = useCallback(
    (messageId: string, placement?: JumpPlacement) => {
      const index = indexOf(messageId);
      if (index === -1) return;
      cancelRetry();
      targetRef.current = messageId;
      placeRef.current = placement ?? MIDDLE;
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        ...placeRef.current,
      });
    },
    [cancelRetry],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const target = targetRef.current;
      // One retry per jump.
      targetRef.current = null;
      if (!target) return;
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        const index = indexOf(target);
        if (index === -1) return;
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          ...placeRef.current,
        });
      }, JUMP_RETRY_MS);
    },
    [],
  );

  return { listRef, jumpToMessage, onScrollToIndexFailed };
}
