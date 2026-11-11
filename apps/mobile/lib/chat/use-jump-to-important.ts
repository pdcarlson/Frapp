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
 * up quietly when the history runs out, a page fails, or the budget is spent:
 * the message is already marked seen, so the strip moves on either way.
 *
 * A channel switch (`resetKey`) drops a jump in progress.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested.
 */
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
  const target = useRef<{ id: string; key: string | null } | null>(null);
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
    (messageId: string) => {
      pages.current = 0;
      target.current = { id: messageId, key: resetKey };
      setAsked((n) => n + 1);
    },
    [resetKey],
  );

  return { jumpToImportant };
}
