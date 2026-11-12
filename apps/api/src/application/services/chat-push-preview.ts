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
export function chatPushPreview(row: {
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  // U+FFFC drawn as an "OBJ" box on the lock screen and in the list (#4346).
  // `ChatService` cleans what it saves; this covers a row written any other way.
  const text = withoutObjectReplacement(row.content ?? '').trim();
  if (text) return Array.from(text).slice(0, 200).join('');
  const raw = Number(row.metadata?.attachment_count);
  const count = Number.isInteger(raw) && raw > 0 ? raw : 0;
  if (count === 1) return 'Sent an attachment';
  if (count > 1) return `Sent ${count} attachments`;
  return 'Sent a message';
}
