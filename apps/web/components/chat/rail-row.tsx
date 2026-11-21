/**
 * A chat rail row's tone, shared by a channel's row and the thread rows under
 * it (#5300), so a thread reads as a channel does: the active row in the
 * accent tint, unread white and bold, muted dimmed, read grey. The phone
 * shares its channel row's styles the same way (`channelTitleStyles`).
 */
export function railRowTone({
  active,
  unread,
  muted,
}: {
  active: boolean;
  unread: boolean;
  muted: boolean;
}): string {
  return active
    ? "bg-accent-subtle font-semibold text-accent-text"
    : unread
      ? "font-bold text-foreground hover:bg-card"
      : muted
        ? "text-muted hover:bg-card hover:text-foreground"
        : "text-muted-foreground hover:bg-card hover:text-foreground";
}

/**
 * The white pip at an unread rail row's start, as Discord draws it (owner,
 * 2026-11-08). The row it sits in is `relative`.
 */
export function RailUnreadPip({ testId }: { testId: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className="absolute left-0 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
    />
  );
}
