import { cn } from "@/lib/utils";

/**
 * The dashboard's unread mark: a neutral `--foreground` dot, never the
 * accent, which belongs to an action and never to a state (foundations.md
 * §5). One component so the notification drawer's rows and Activity's rows
 * (#4405) draw the same dot. It holds its slot when read, so a row doesn't
 * shift as its dot clears. Decorative: the row says "Unread" in words for a
 * screen reader.
 */
export function UnreadDot({
  unread,
  className,
}: {
  unread: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-unread-dot={unread ? "" : undefined}
      className={cn(
        "size-2 shrink-0 rounded-full",
        unread ? "bg-foreground" : "bg-transparent",
        className,
      )}
    />
  );
}
