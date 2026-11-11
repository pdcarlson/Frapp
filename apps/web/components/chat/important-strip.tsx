"use client";

import { ArrowUp, CircleAlert, X } from "lucide-react";
import {
  IMPORTANT_STRIP_DISMISS_LABEL,
  importantStripLabel,
  type ImportantMessageRef,
} from "@repo/hooks";
import { IconButton } from "@/components/ui/icon-button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

export interface ImportantStripProps {
  total: number;
  /** The oldest unseen one, which a click jumps to. */
  next: ImportantMessageRef | null;
  /** Who sent `next`, or `null` when the strip should name no one. */
  nextSender: string | null;
  onJump: () => void;
  onDismiss: () => void;
}

/**
 * The "1 important message" strip (#4186, slice 4 of #3921), between the
 * channel header and the timeline.
 *
 * It wears the Important row's own paint (components.md § A flagged row): the
 * `--destructive-tint` fill, a 2px `--destructive` bar on the leading edge,
 * and the alert glyph and count in `--destructive-text`, so it reads as "this
 * is about that red message". After the count, the next one's sender and
 * first words in `--muted-foreground`, cut to one line.
 *
 * The whole strip is one button that jumps to the oldest unseen message; the
 * × beside it marks every one seen. Both are the server's to decide
 * (`useImportantMessages`), so nothing here counts.
 *
 * Always mounted as a live region, empty when there is nothing unseen, so a
 * strip that appears mid-visit (someone flags a message) is announced.
 */
export function ImportantStrip({
  total,
  next,
  nextSender,
  onJump,
  onDismiss,
}: ImportantStripProps) {
  const show = total > 0 && next !== null;
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {show ? (
        <div
          data-slot="important-strip"
          className="flex h-9 items-center border-b border-border bg-destructive-tint shadow-[inset_2px_0_0_var(--destructive)] pointer-coarse:h-11"
        >
          <button
            type="button"
            onClick={onJump}
            className={cn(
              "flex h-full min-w-0 flex-1 items-center gap-2 pl-4 pr-2 text-left text-caption hover:bg-destructive-tint-hover",
              FOCUS_RING_OFFSET,
            )}
          >
            <CircleAlert
              className="h-3.5 w-3.5 shrink-0 text-destructive-text"
              aria-hidden="true"
            />
            <span className="shrink-0 font-semibold text-destructive-text">
              {importantStripLabel(total)}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
              {"· "}
              {nextSender ? `${nextSender}: ` : ""}
              {next.excerpt}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 font-semibold text-foreground">
              Jump
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
          <IconButton
            label={IMPORTANT_STRIP_DISMISS_LABEL}
            onClick={onDismiss}
            className="mr-1 shrink-0"
          >
            <X />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
