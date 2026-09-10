"use client";

import { UNAVAILABLE_QUOTE } from "@repo/chat-core/reply-preview";
import { cn } from "@/lib/utils";

export {
  DELETED_MESSAGE_PLACEHOLDER,
  UNAVAILABLE_QUOTE,
  replyPreviewText,
  type MessagePreviewSource,
} from "@repo/chat-core/reply-preview";

interface QuotedMessageProps {
  /**
   * Author label for the quoted message, resolved by the caller — or `null`
   * when the message is not in the loaded window, which renders the
   * unavailable variant and ignores `preview`.
   *
   * Nothing backfills older history today (`useChatChannel` fetches one window
   * and exposes no pagination — #1571), so the unavailable case is not an edge:
   * any reply to a message older than the window lands there. It is a variant
   * of this component rather than its own, because the two must share the rule,
   * the indent and the type treatment — a fallback that drifts to a different
   * indent is exactly the branch nobody re-screenshots.
   */
  author: string | null;
  preview: string | null;
  /**
   * Opens the quoted message's thread. Optional: the composer's staged-reply
   * strip quotes a message with nowhere to navigate to, so it renders the same
   * shape as static text rather than as a dead control.
   */
  onOpen?: () => void;
  className?: string;
}

/**
 * The quote shape shared by the timeline row and the composer's staged-reply
 * strip — one component so the two cannot drift apart, which is the failure
 * mode a "quote preview" invites (the reply you are writing must look like the
 * reply you just sent).
 *
 * A left rule plus author and preview on one line. `text-[12.5px]` and
 * `text-muted-foreground` are the meta-line treatment `message-item.tsx` already
 * uses for the author/time caption, so a quote reads as chrome around the
 * message rather than as a second message.
 */
export function QuotedMessage({
  author,
  preview,
  onOpen,
  className,
}: QuotedMessageProps) {
  const unavailable = author === null;

  const shared = cn(
    "flex min-w-0 items-baseline gap-1.5 border-l-2 border-border pl-2",
    "text-[12.5px] text-muted-foreground",
    unavailable && "italic",
    className,
  );

  const content = unavailable ? (
    <span className="truncate">{UNAVAILABLE_QUOTE}</span>
  ) : (
    <>
      <span className="shrink-0 font-semibold">{author}</span>
      <span className="truncate">{preview}</span>
    </>
  );

  // An unavailable quote has nothing to open, so it is never a control even
  // when the caller offers `onOpen` — the parent it would navigate to is the
  // thing that is missing.
  if (!onOpen || unavailable) {
    return <div className={shared}>{content}</div>;
  }

  return (
    <button
      type="button"
      // `text-left` because a button centres its text by default, which would
      // put a short quote in the middle of the row while a long one starts at
      // the rule — the same quote jumping horizontally with its own length.
      className={cn(shared, "text-left hover:text-foreground")}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
