/**
 * Who is typing, directly above a composer: the channel's and a thread's
 * (`typingLabel` words it). Where mobile draws it too, and where Discord and
 * Slack put it.
 *
 * Always mounted and one caption line tall, so someone starting or stopping
 * typing moves nothing: it used to mount only while someone typed, and every
 * keystroke pause slid the timeline, or the reply box, up and down a line
 * (2026-11-11). Empty, it is hidden from a screen reader. Not a live region,
 * as it never was: a line that changes with every pause would talk over the
 * conversation.
 */
export function TypingLine({ label }: { label: string | null }) {
  return (
    <p
      data-testid="typing-line"
      aria-hidden={label ? undefined : true}
      className="h-5 shrink-0 truncate px-4 text-caption leading-5 text-muted-foreground"
    >
      {label}
    </p>
  );
}
