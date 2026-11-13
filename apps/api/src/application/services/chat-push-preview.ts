import { withoutObjectReplacement } from '@repo/validation';

/**
 * The body of a single chat push: the first 200 characters of the message, or,
 * for a message with no text (a photo or file sent on its own), what was sent.
 * Those used to push an empty body under the sender's name (#3846). The cut is
 * by code point, so it never splits an emoji into a broken character.
 *
 * The push worker writes it into each recipient's in-app row, and an edit
 * rewrites those rows with it (#4418), so the two stay one rule.
 */
export function chatPushPreview(
  row: {
    content?: string | null;
    metadata?: Record<string, unknown> | null;
    forwarded_from?: ChatPushForwardedCopy | null;
  },
  options: { withholdForwarded?: boolean } = {},
): string {
  // U+FFFC drawn as an "OBJ" box on the lock screen and in the list (#4346).
  // `ChatService` cleans what it saves; this covers a row written any other way.
  const text = withoutObjectReplacement(row.content ?? '').trim();
  if (text) return cut(text);
  // A forward with no comment (#4864) previews the copy. A recipient who
  // blocked the original's author (`withholdForwarded`), or a copy whose
  // original was deleted, reads only that something was forwarded.
  const copy = row.forwarded_from;
  if (copy && typeof copy === 'object') {
    if (options.withholdForwarded || copy.deleted === true) {
      return 'Forwarded a message';
    }
    const quoted = withoutObjectReplacement(
      typeof copy.content === 'string' ? copy.content : '',
    ).trim();
    if (quoted) return cut(`Forwarded: ${quoted}`);
    if (copy.gif && typeof copy.gif === 'object') return 'Forwarded a GIF';
    return 'Forwarded a message';
  }
  // A GIF message (#4631) is the GIF, with no text of its own.
  const gif = row.metadata?.gif;
  if (gif && typeof gif === 'object') return 'Sent a GIF';
  const raw = Number(row.metadata?.attachment_count);
  const count = Number.isInteger(raw) && raw > 0 ? raw : 0;
  if (count === 1) return 'Sent an attachment';
  if (count > 1) return `Sent ${count} attachments`;
  return 'Sent a message';
}

/** What the preview reads of a forward's copy; loose, since a Realtime row is untyped. */
export interface ChatPushForwardedCopy {
  content?: unknown;
  gif?: unknown;
  deleted?: unknown;
}

/** The first 200 code points, so an emoji is never split. */
function cut(text: string): string {
  return Array.from(text).slice(0, 200).join('');
}
