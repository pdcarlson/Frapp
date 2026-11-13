"use client";

import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The one sign that a form opened on a kept draft (`@repo/hooks/kept-drafts`,
 * #4593): a quiet caption at the start of the panel's footer, with Discard to
 * start over. No banner row and nothing that moves while the member types:
 * it is there from the moment the form opens, and goes only when they discard
 * or save. Gmail's compose and Linear's issue draft say as little.
 */
export function KeptDraftNote({ onDiscard }: { onDiscard: () => void }) {
  return (
    <p className="mr-auto flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
      <span>Draft restored</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onDiscard}
        className={cn(
          "rounded-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
          FOCUS_RING_OFFSET,
        )}
      >
        Discard
      </button>
    </p>
  );
}
