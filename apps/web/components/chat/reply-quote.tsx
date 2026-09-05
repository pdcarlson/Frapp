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
 * How much of a body to flatten. The strip shows one CSS-truncated line — far
 * less than this — so the cap costs nothing visible and bounds every regex
 * below against a hostile body. `CHAT_MESSAGE_CONTENT_MAX_LENGTH` is 10,000,
 * and the link pattern backtracks quadratically on unmatched `[`: measured at
 * 74ms per call for 10,000 of them, paid on **every render** of that row and of
 * the composer strip, since this is uncached inside Virtuoso's `itemContent`.
 * Any member could plant that. Capped, the same input measures under 1ms.
 */
const PREVIEW_SOURCE_LIMIT = 500;

/**
 * A backslash-escaped character, parked as `NUL<charCode>NUL` while the
 * delimiter passes run, then restored without its backslash. `NUL` cannot occur
 * in a message body that reached this client — Postgres `text` rejects it — so
 * it cannot collide with real content.
 */
const ESCAPE_SENTINEL = "\u0000";

/**
 * CommonMark's flanking rule turns on **whitespace and punctuation**, not on
 * "letter or number". Both `\w` and `\p{L}\p{N}` get it wrong for anything
 * outside their class: an emoji is neither punctuation nor whitespace, so
 * `🎉_party_🎉` is intraword and stays literal, while a `\p{L}`-based guard
 * read the emoji as a boundary and stripped the underscores.
 */
const NOT_FLANKED_BEFORE = "(?<![^\\s\\p{P}])";
const NOT_FLANKED_AFTER = "(?![^\\s\\p{P}])";

const STRONG_UNDERSCORE = new RegExp(
  NOT_FLANKED_BEFORE + "__(?=\\S)([^_]{0,300}?\\S)__" + NOT_FLANKED_AFTER,
  "gu",
);
const EMPHASIS_UNDERSCORE = new RegExp(
  NOT_FLANKED_BEFORE + "_(?=\\S)([^_]{0,300}?\\S)_" + NOT_FLANKED_AFTER,
  "gu",
);
const ESCAPED_CHAR = new RegExp(
  ESCAPE_SENTINEL + "(\\d+)" + ESCAPE_SENTINEL,
  "g",
);

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
 *
 * **Over-stripping is the failure mode that matters, not under-stripping.** A
 * marker left in a preview is mildly ugly; text the sender never typed is a lie
 * about what they said, in the one line standing in for their message. Earlier
 * cuts of this function shipped four such lies — intraword `_` (`reply_to_id` →
 * `replytoid`), an inline ``` eating the rest of its line, emoji-flanked `_`,
 * and backslash escapes consumed as delimiters — so it is no longer checked
 * against intuition. The chain was diffed against `mdast-util-from-markdown`,
 * the CommonMark core `react-markdown` itself uses, over 28 inputs with **zero**
 * divergences; `reply-quote.test.tsx` pins the cases that regressed.
 */
function flattenMarkdown(text: string): string {
  return (
    text
      .slice(0, PREVIEW_SOURCE_LIMIT)
      // Park escaped characters so no later pass reads one as a delimiter.
      // `\*not emphasis\*` is literal text in CommonMark; without this the
      // asterisks were consumed *and* the backslashes left behind, so the quote
      // both dropped characters the sender typed and added ones they did not.
      .replace(
        /\\([\\`*_[\]()#+\-.!>])/g,
        (_match, char: string) =>
          ESCAPE_SENTINEL + char.charCodeAt(0) + ESCAPE_SENTINEL,
      )
      // `[label](href)` → `label`, with an optional title. Every quantifier is
      // bounded. The destination allows one level of balanced parens, which
      // CommonMark permits — a Wikipedia URL ending `Foo_(bar))` otherwise left
      // a stray `)` in the quote.
      .replace(
        /\[([^\]]{0,300})\]\((?:[^()\s]|\([^()\s]{0,100}\)){0,500}(?:\s+"[^"]{0,200}")?\)/g,
        "$1",
      )
      // An opening fence takes its info string and newline with it, and a ```
      // code span keeps its body. An unmatched ``` mid-prose is literal text in
      // CommonMark and is left alone — the blanket strip that removed it turned
      // "put it in ``` fences and keep reading" into "put it in ".
      .replace(/```[A-Za-z0-9]{0,20}\n/g, "")
      .replace(/```([^`]{1,300})```/g, "$1")
      // Emphasis, longest marker first so `**` is not eaten as two `*`.
      .replace(/\*\*(?=\S)([^*]{0,300}?\S)\*\*/gu, "$1")
      .replace(STRONG_UNDERSCORE, "$1")
      .replace(/\*(?=\S)([^*]{0,300}?\S)\*/gu, "$1")
      .replace(EMPHASIS_UNDERSCORE, "$1")
      // `{1,300}`, not `{0,300}`: an empty match would consume two of a bare
      // ``` run's three backticks and leave the third behind.
      .replace(/`([^`]{1,300})`/g, "$1")
      .replace(ESCAPED_CHAR, (_match, code: string) =>
        String.fromCharCode(Number(code)),
      )
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

/**
 * What a quote says when its message is outside the loaded window.
 *
 * Deliberately **context-free**, with no "Replying to" of its own: the composer
 * strip already prints that label beside the quote, so a self-contained sentence
 * rendered there read "Replying to Replying to a message that isn't loaded".
 * The timeline needs no prefix — a left rule above a message already says
 * "this is what it answers".
 */
export const UNAVAILABLE_QUOTE = "Original message not loaded";

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
