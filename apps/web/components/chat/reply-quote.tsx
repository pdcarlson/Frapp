"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import { cn } from "@/lib/utils";

/**
 * Human label for a card kind, used only when the card carries no free text of
 * its own. Deliberately not derived from `CARD_KINDS` in `./renderers`: that set
 * answers "is this a bubble?" for layout, and a quote needs a *noun* — the two
 * would drift into each other's jobs if one list served both.
 */
const KIND_LABELS: Record<string, string> = {
  poll: "Poll",
  announcement: "Announcement",
  system_audit: "Audit entry",
  points: "Points",
  task: "Task",
  event: "Event",
  dues: "Dues",
  hours: "Service hours",
  loading: "Card",
};

/**
 * One line standing in for a message inside a quote.
 *
 * Newlines collapse to spaces here rather than being left to CSS: a quote strip
 * is one line by design, and `white-space` alone would let a multi-paragraph
 * parent set the strip's height before `truncate` ever applied. The *length*
 * cut is CSS (`truncate`), so the visible text still fills whatever width the
 * surface gives it instead of a guessed character count.
 *
 * Order matters. A deleted parent says so — the tombstone is the honest preview,
 * and falling through to its blanked `content` would render an empty quote that
 * reads as a rendering bug. Then real text. Then a file-only message, which is a
 * valid send (`spec/behavior/chat/README.md`, "A message may be nothing but a
 * file") and would otherwise quote as nothing at all. Then the kind, for a card
 * whose body lives in `payload`.
 */
export function replyPreviewText(message: ChatMessage): string {
  if (message.is_deleted) return "[message deleted]";

  const text = message.content?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length > 0) return text;

  const attachments = message.attachment_count ?? 0;
  if (attachments > 0) {
    return attachments === 1 ? "Attachment" : `${attachments} attachments`;
  }

  return KIND_LABELS[message.kind ?? "text"] ?? "Message";
}

interface QuotedMessageProps {
  /** Author label for the quoted message, resolved by the caller. */
  author: string;
  preview: string;
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
  const content = (
    <>
      <span className="shrink-0 font-semibold">{author}</span>
      <span className="truncate">{preview}</span>
    </>
  );

  const shared = cn(
    "flex min-w-0 items-baseline gap-1.5 border-l-2 border-border pl-2",
    "text-[12.5px] text-muted-foreground",
    className,
  );

  if (!onOpen) {
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

interface ReplyQuoteProps {
  /**
   * The parent message, or `null` when `reply_to_id` names a message outside
   * the loaded window.
   *
   * Nothing backfills older history today (`useChatChannel` fetches one window
   * and exposes no pagination — #1571), so this is not an edge case: any reply
   * to a message older than the window lands here. It renders an explicit
   * unavailable line rather than nothing, because a reply that silently loses
   * its quote is indistinguishable from a message that was never a reply.
   */
  parent: ChatMessage | null;
  /** Author label for `parent`; ignored when `parent` is null. */
  author: string;
  onOpen?: () => void;
}

/** The quoted parent rendered above a reply in the main timeline (AC 2). */
export function ReplyQuote({ parent, author, onOpen }: ReplyQuoteProps) {
  if (!parent) {
    return (
      <div className="mb-1 flex min-w-0 items-baseline gap-1.5 border-l-2 border-border pl-2 text-[12.5px] italic text-muted-foreground">
        Replying to a message that isn&rsquo;t loaded
      </div>
    );
  }

  return (
    <QuotedMessage
      className="mb-1"
      author={author}
      preview={replyPreviewText(parent)}
      onOpen={onOpen}
    />
  );
}
