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
 * `role="status"` so the failure is announced once when it appears, not on every
 * poll: a live region speaks when its text changes, and a repeat failure
 * renders the same text.
 */
export function StaleReadNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-warning"
    >
      <span>{message}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
