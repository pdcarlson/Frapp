"use client";

import { Button } from "@/components/ui/button";

/**
 * The line a list shows when a background read failed but its last good read
 * is still on screen.
 *
 * Flushed routes keep loaded rows through a failed refetch rather than swapping
 * them for an error state (`spec/ui/web-dashboard/README.md` § Surface
 * decisions), which leaves nothing on screen to say the rows have stopped
 * updating. A meter that froze mid-deletion, or a channel list an officer has
 * since lost access to, reads as current without this. The import watch panel
 * drew the first one; this is that line, shared.
 *
 * **The live region is always mounted**, and empty while the read is current,
 * so the line appearing is announced: a region that mounts already populated
 * is not reliably read out (the chat timeline's `BlockListNotice` keeps its
 * region mounted for the same reason). A repeat failure renders the same text,
 * so a poll that keeps failing is not announced again. Mount it above the
 * branches its read can switch between, and it takes no room while empty,
 * even in a `space-y-*` stack.
 */
export function StaleReadNotice({
  stale,
  message,
  onRetry,
}: {
  stale: boolean;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="status" className="empty:m-0">
      {stale ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-warning">
          <span>{message}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
