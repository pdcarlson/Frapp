import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The one line a list shows where its rows would be when there are none to
 * show: a search that matched nothing, a period with no activity, a board
 * where everyone is at 0. It replaces the old centered empty card for those
 * cases, so the page keeps its layout and the reader stays where they were.
 * Errors and offline keep their cards (`nested-states.tsx`), because there the
 * list really can't show anything.
 *
 * Not a live region: a page can hold several of these at once (a board at 0
 * beside a quiet ledger), and each would speak on load.
 */
export function InlineNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("py-1 text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/**
 * The way back out of an {@link InlineNote}, such as Clear search. A run of
 * text in the sentence, in the text's own tone rather than the accent, which
 * belongs to a page's primary action (foundations §6).
 */
export function InlineNoteAction({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "rounded-sm font-semibold text-foreground underline underline-offset-4 hover:no-underline",
        FOCUS_RING_OFFSET,
        className,
      )}
      {...props}
    />
  );
}
