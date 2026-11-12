"use client";

import { jumpToLatestLabel } from "@repo/chat-core/jump-to-latest";
import { Button } from "@/components/ui/button";
import { JumpToLatestGlyph } from "./chat-glyphs";

/**
 * The web thread's way back to the newest message once the reader has scrolled
 * a screen or more into history, or once something new lands out of sight
 * below them (`useJumpToLatest` decides when). The web face of mobile's
 * `components/chat/jump-to-latest-button.tsx`, in the same place and the same
 * recipe: a small round `↓` over the list's bottom-right corner, just above the
 * composer, so it reserves no height and the thread under it never moves.
 *
 * Elevated `--popover` with the outlined button's edge, the neutral recipe a
 * floating control takes, and the chapter's solid accent only on the dot that
 * says a newer message landed out of sight. The secondary icon button's size,
 * 36 to a mouse and the 44 floor to a finger.
 *
 * The caller renders it only while `useJumpToLatest` says to (`showsJump`).
 */
export function JumpToLatestButton({
  hasNew,
  onJump,
}: {
  hasNew: boolean;
  onJump: () => void;
}) {
  const label = jumpToLatestLabel(hasNew);
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onJump}
      className="absolute bottom-3 right-4 z-10 rounded-full bg-popover"
    >
      <JumpToLatestGlyph />
      {hasNew ? (
        <span
          data-testid="jump-to-latest-dot"
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </Button>
  );
}
