import type { ChatMessageKind } from "./types";

/**
 * Tombstone a deleted message shows in a quote and in the bubble that
 * row still occupies (web and mobile). Web's delete-confirm dialog uses
 * it too.
 *
 * One string because a quote of a deleted parent and the parent's own row
 * sit in the same viewport — two wordings would put two tombstones on
 * screen at once. It matches the server rewrite in `ChatService` (`content:
 * '[message deleted]'`) as a display choice, not a wire contract: the
 * server value travels in the row; this is what a client draws when it has
 * no body left to quote.
 */
export const DELETED_MESSAGE_PLACEHOLDER = "[message deleted]";

/**
 * Human label for a card kind, used only when the card carries no free text of
 * its own. `text` and `imported` stay absent on purpose — they quote by their
 * body. A kind added server-first still falls through to "Message".
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
  rush: "Candidate",
  loading: "Card",
};

/**
 * How much of a body to flatten. The strip shows one truncated line — far
 * less than this — so the cap costs nothing visible and bounds every regex
 * below against a hostile body. `CHAT_MESSAGE_CONTENT_MAX_LENGTH` is 10,000,
 * and the link pattern backtracks quadratically on unmatched `[`. Capped, the
 * same input stays under 1ms.
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
 * `🎉_party_🎉` is intraword and stays literal.
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
 * Flatten the markdown subset the web bubble renders down to the text a
 * reader sees, so a quote and the message it stands for say the same thing.
 *
 * Scoped to bold, italic, inline code, fenced code, and links — nothing
 * wider, because nothing wider renders. Link *text* is kept and the href
 * dropped.
 *
 * **Over-stripping is the failure mode that matters, not under-stripping.**
 * The chain was diffed against `mdast-util-from-markdown` over 28 inputs
 * with zero divergences; `reply-preview.spec.ts` pins the cases that
 * regressed.
 */
function flattenMarkdown(text: string): string {
  return (
    text
      .slice(0, PREVIEW_SOURCE_LIMIT)
      .replace(
        /\\([\\`*_[\]()#+\-.!>])/g,
        (_match, char: string) =>
          ESCAPE_SENTINEL + char.charCodeAt(0) + ESCAPE_SENTINEL,
      )
      .replace(
        /\[([^\]]{0,300})\]\((?:[^()\s]|\([^()\s]{0,100}\)){0,500}(?:\s+"[^"]{0,200}")?\)/g,
        "$1",
      )
      .replace(/```[A-Za-z0-9]{0,20}\n/g, "")
      .replace(/```([^`]{1,300})```/g, "$1")
      .replace(/\*\*(?=\S)([^*]{0,300}?\S)\*\*/gu, "$1")
      .replace(STRONG_UNDERSCORE, "$1")
      .replace(/\*(?=\S)([^*]{0,300}?\S)\*/gu, "$1")
      .replace(EMPHASIS_UNDERSCORE, "$1")
      .replace(/`([^`]{1,300})`/g, "$1")
      .replace(ESCAPED_CHAR, (_match, code: string) =>
        String.fromCharCode(Number(code)),
      )
  );
}

/**
 * One line standing in for a message inside a quote.
 *
 * Newlines collapse to spaces here rather than being left to CSS: a quote
 * strip is one line by design. Order matters. A deleted parent says so —
 * falling through to its blanked `content` would render an empty quote that
 * reads as a rendering bug. Then real text. Then a file-only message. Then
 * the kind, for a card whose body lives in `payload`.
 *
 * The argument is a structural preview source, not `ChatMessage`, because
 * the Bookmarks panel serves a nine-field projection with no `kind` or
 * `attachment_count`.
 */
export type MessagePreviewSource = {
  content?: string | null;
  is_deleted?: boolean | null;
  attachment_count?: number | null;
  kind?: ChatMessageKind | null;
};

export function replyPreviewText(message: MessagePreviewSource): string {
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
 * Deliberately **context-free**, with no "Replying to" of its own: the web
 * composer strip already prints that label beside the quote, so a
 * self-contained sentence rendered there read "Replying to Replying to a
 * message that isn't loaded". The timeline needs no prefix — a left rule
 * above a message already says "this is what it answers".
 */
export const UNAVAILABLE_QUOTE = "Original message not loaded";
