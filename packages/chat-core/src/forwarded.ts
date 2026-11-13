/**
 * The words a forwarded message's card draws (#4864), one wording for web and
 * mobile. `spec/behavior/chat/README.md` § Forward a message owns the
 * behavior; `ForwardedFrom` in `./types` is the copy itself.
 */

/** The label over a forward's card, as Discord and WhatsApp label one. */
export const FORWARDED_LABEL = "Forwarded";

/**
 * What a card says in place of the original once it was deleted: the server
 * blanks every forward's copy along with it (`ForwardedFrom.deleted`).
 */
export const FORWARDED_ORIGINAL_DELETED = "Original message was deleted";

/**
 * The card's line for the files the original carried. The files stay with the
 * original, so the card counts them rather than drawing them. `null` for none.
 */
export function forwardedAttachmentLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const n = Math.floor(count);
  return n === 1 ? "1 attachment" : `${n} attachments`;
}
