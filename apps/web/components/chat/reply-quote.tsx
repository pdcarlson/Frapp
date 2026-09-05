"use client";

import type { ChatMessage, ChatMessageKind } from "@repo/chat-core/types";
import { DELETED_MESSAGE_PLACEHOLDER } from "./message-placeholders";
import { cn } from "@/lib/utils";

/**
 * Human label for a card kind, used only when the card carries no free text of
 * its own. Deliberately not derived from `CARD_KINDS` in `./renderers`: that set
 * answers "is this a bubble?" for layout, and a quote needs a *noun* — the two
 * would drift into each other's jobs if one list served both.
 *
 * `Partial<Record<ChatMessageKind, …>>` rather than `Record<string, …>`, so a
 * typo'd or retired key fails typecheck while `text` and `imported` — the two
 * kinds that legitimately have no noun, because they quote by their body — stay
 * absent on purpose. It does not force exhaustiveness: a kind added
 * server-first would still fall through to the generic label rather than
 * breaking the build, which is the right trade for a preview string.
 */
const KIND_LABELS: Partial<Record<ChatMessageKind, string>> = {
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
 * Flatten the markdown subset `MessageMarkdown` renders down to the text a
 * reader sees, so the quote and the message it stands for say the same thing.
 *
 * Without this the strip shows *source*: replying to
 * `See **the signed** [budget](https://drive.google.com/file/d/1aB…/view)`
 * quotes the raw link, and because a quote is one truncated line, the cut lands
 * inside the URL — the line whose only job is identifying the parent becomes
 * punctuation and a Drive id.
 *
 * Scoped to exactly `ALLOWED_ELEMENTS` in `./renderers/message-markdown.tsx`
 * (bold, italic, inline code, fenced code, links) — nothing wider, because
 * nothing wider renders. Link *text* is kept and the href dropped: the text is
 * what the reader saw.
 */
function flattenMarkdown(text: string): string {
  return (
    text
      // `[label](href)` → `label`. Non-greedy, and the href may not contain a
      // closing paren, which is CommonMark's own rule for an unescaped one.
      .replace(/\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
      // Fenced blocks keep their body; the fence and any info string go.
      .replace(/```[^\n]*\n?/g, "")
      // Emphasis and inline code markers. Applied after links so a `**bold**`
      // link label survives with its text intact.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.*?\S)\1/g, "$2")
      .replace(/`([^`]*)`/g, "$1")
  );
}

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
  if (message.is_deleted) return DELETED_MESSAGE_PLACEHOLDER;

  const text = flattenMarkdown(message.content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 0) return text;

  const attachments = message.attachment_count ?? 0;
  if (attachments > 0) {
    return attachments === 1 ? "Attachment" : `${attachments} attachments`;
  }

  return KIND_LABELS[message.kind ?? "text"] ?? "Message";
}

/** What a quote says when its message is outside the loaded window. */
export const UNAVAILABLE_QUOTE = "Replying to a message that isn’t loaded";

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
