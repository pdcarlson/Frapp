import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  AiTextCipherError,
  openAiText,
  sealAiText,
  type AiTextKeyRing,
} from './ai-text-cipher';

/**
 * Ask's report receipt (#4315, `spec/behavior/ai.md` § Stored AI text).
 *
 * Ask stores nothing, so when a member reports an answer the server no longer
 * has the exchange. Rather than keep every exchange in case one is reported,
 * the server seals the exchange into the answer it sends (`report_receipt`)
 * and forgets it. The client holds the envelope, which only the server can
 * open, and hands it back with a report. Only then is anything stored, as
 * the report's own sealed row.
 *
 * The receipt is bound to the chapter and the asker (the cipher's
 * additional data), so it opens only for the member it was issued to, in the
 * chapter it was issued in. Because the server sealed it, what a report keeps
 * is what Frapp sent and showed, never text a client made up.
 *
 * It is compressed before it is sealed: the passages handed to the model are
 * most of it, and the answer is sent on every ask.
 */

export const ASK_REPORT_RECEIPT_VERSION = 1;

/** How long after the answer it may be reported. */
export const ASK_REPORT_RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A plaintext marker, so a later format can be told apart. */
const PLAINTEXT_PREFIX = 'z1:';

/** What the member was shown, from the `done` event. */
export interface AskReceiptShown {
  status: string;
  reason: string | null;
  text: string;
  citations: Array<{ source: number; at: number; quote: string }>;
  sources: Array<{
    kind: string;
    title: string;
    detail: string | null;
    date: string | null;
  }>;
  left_out_messages: number;
  unverified_citations: number;
  truncated: boolean;
}

export interface AskReportReceipt {
  v: typeof ASK_REPORT_RECEIPT_VERSION;
  ask_id: string;
  issued_at: string;
  question: string;
  /** What the model wrote, before Frapp's checks changed what was shown. */
  written: string;
  shown: AskReceiptShown;
  /** Every source the model was handed, as it read them. */
  given: Array<{ title: string; text: string }>;
  /** The live-data tools that ran. */
  tools: string[];
  model: string;
  prompt_version: string;
  /**
   * Members whose own words are in `given` (chat authors). A report holding
   * this is deleted early when one of them deletes their account or answers
   * No on the AI sheet. Never sent anywhere readable: the receipt is sealed.
   */
  quoted_user_ids: string[];
}

export class AskReportReceiptError extends Error {
  constructor(readonly reason: 'invalid' | 'expired') {
    super(`Ask report receipt: ${reason}`);
    this.name = 'AskReportReceiptError';
  }
}

/** The context a receipt is bound to: one asker, in one chapter. */
export function askReportReceiptContext(
  chapterId: string,
  userId: string,
): string {
  return `ask-report-receipt:${chapterId}:${userId}`;
}

/** Seals a receipt, or returns null when there is no key to seal with. */
export function sealAskReportReceipt(
  ring: AiTextKeyRing | null,
  receipt: AskReportReceipt,
  binding: { chapterId: string; userId: string },
): string | null {
  if (!ring?.length) return null;
  const packed =
    PLAINTEXT_PREFIX +
    deflateRawSync(Buffer.from(JSON.stringify(receipt), 'utf8')).toString(
      'base64',
    );
  return sealAiText(
    ring,
    packed,
    askReportReceiptContext(binding.chapterId, binding.userId),
  );
}

/**
 * Opens a receipt handed back with a report. Throws `invalid` for one that
 * was not sealed by this server for this member in this chapter (or was
 * changed), and `expired` for one older than {@link ASK_REPORT_RECEIPT_MAX_AGE_MS}.
 * Throws `AiTextCipherError('no_key')` when the server holds no key.
 */
export function openAskReportReceipt(
  ring: AiTextKeyRing | null,
  envelope: string,
  binding: { chapterId: string; userId: string },
  now: Date,
): AskReportReceipt {
  let packed: string;
  try {
    packed = openAiText(
      ring,
      envelope,
      askReportReceiptContext(binding.chapterId, binding.userId),
    );
  } catch (error) {
    if (error instanceof AiTextCipherError && error.reason === 'no_key') {
      throw error;
    }
    throw new AskReportReceiptError('invalid');
  }
  if (!packed.startsWith(PLAINTEXT_PREFIX)) {
    throw new AskReportReceiptError('invalid');
  }
  let receipt: AskReportReceipt;
  try {
    receipt = JSON.parse(
      inflateRawSync(
        Buffer.from(packed.slice(PLAINTEXT_PREFIX.length), 'base64'),
      ).toString('utf8'),
    ) as AskReportReceipt;
  } catch {
    throw new AskReportReceiptError('invalid');
  }
  if (receipt?.v !== ASK_REPORT_RECEIPT_VERSION) {
    throw new AskReportReceiptError('invalid');
  }
  const issued = Date.parse(receipt.issued_at);
  if (
    Number.isNaN(issued) ||
    now.getTime() - issued > ASK_REPORT_RECEIPT_MAX_AGE_MS
  ) {
    throw new AskReportReceiptError('expired');
  }
  return receipt;
}
