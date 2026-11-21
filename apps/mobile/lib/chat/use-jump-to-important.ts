import { useCallback, useEffect, useRef, useState } from "react";

/** How many older pages the strip's jump loads looking for its message. */
export const IMPORTANT_JUMP_MAX_OLDER_PAGES = 10;

/**
 * The Important strip's Show (#4186): jump to a message that may be older
 * than the loaded window.
 *
 * `useJumpToMessage` scrolls only to a row in the list, which is enough for a
 * reply quote. A strip's message can be up to 14 days back, so this pages
 * older history for it first, one page per render, up to
 * {@link IMPORTANT_JUMP_MAX_OLDER_PAGES}, as web's jump does (#1571). It gives
 * up when the history runs out, a page fails, or the budget is spent. The
 * strip's jump gives up quietly: the message is already marked seen, so the
 * strip moves on either way. A jump a member asked for by name (a Pinned or
 * Saved row, #3723) passes `onMiss`, which says why, as web's unreachable
 * notice does.
 *
 * A channel switch (`resetKey`) drops a jump in progress.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested.
 */
/** Why a jump gave up: web's `UnreachableReason`, less what a phone can't tell. */
export type JumpMissReason = "far" | "missing" | "error";

/** What a phone says when a jump gives up (`spec/ui/design-system/writing.md`). */
export const JUMP_MISS_COPY: Record<JumpMissReason, string> = {
  far: "That message is further back than the history loaded here. Scroll up to load more.",
  missing: "That message isn't in this channel anymore.",
  error: "Couldn't load the messages needed to reach that message.",
};

export function useJumpToImportant({
  rows,
  resetKey,
  hasOlder,
  isLoadingOlder,
  olderError,
  loadOlder,
  jumpToMessage,
}: {
  rows: readonly { message: { id: string } }[];
  resetKey: string | null;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
  loadOlder: () => unknown;
  jumpToMessage: (messageId: string) => void;
}) {
  // The jump in progress, with the channel it started in: a switch drops it
  // on the same render. A ref, not state, so ending a jump inside the effect
  // below doesn't render again; `asked` is what runs the effect anew.
  const target = useRef<{
    id: string;
    key: string | null;
    onMiss?: (reason: JumpMissReason) => void;
  } | null>(null);
  const pages = useRef(0);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    const current = target.current;
    if (!current) return;
    if (current.key !== resetKey) {
      target.current = null;
      return;
    }
    if (rows.some((row) => row.message.id === current.id)) {
      target.current = null;
      jumpToMessage(current.id);
      return;
    }
    if (isLoadingOlder) return;
    if (
      !hasOlder ||
      olderError ||
      pages.current >= IMPORTANT_JUMP_MAX_OLDER_PAGES
    ) {
      target.current = null;
      current.onMiss?.(olderError ? "error" : hasOlder ? "far" : "missing");
      return;
    }
    pages.current += 1;
    void loadOlder();
  }, [
    asked,
    resetKey,
    rows,
    hasOlder,
    isLoadingOlder,
    olderError,
    loadOlder,
    jumpToMessage,
  ]);

  const jumpToImportant = useCallback(
    (
      messageId: string,
      options?: { onMiss?: (reason: JumpMissReason) => void },
    ) => {
      pages.current = 0;
      target.current = {
        id: messageId,
        key: resetKey,
        onMiss: options?.onMiss,
      };
      setAsked((n) => n + 1);
    },
    [resetKey],
  );

  return { jumpToImportant };
}
