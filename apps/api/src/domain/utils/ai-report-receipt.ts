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

/**
 * Where one thing the model was handed came from, by id and never by text
 * (#4713). Posting an answer to a channel reads these to check, when the
 * asker posts, whether everyone in that channel could open each one
 * (`AskPostService`). `reach` is the tool's own (`AskTool.reach`), and
 * `events` the events it listed that not every member can see.
 */
export type AskGivenRef =
  | { type: 'document'; id: string }
  | { type: 'meeting'; id: string }
  | { type: 'chat' }
  /** The channel the question was asked from: open to that channel alone. */
  | { type: 'channel'; id: string }
  | {
      type: 'tool';
      name: string;
      reach: 'chapter' | 'asker' | 'events';
      events?: string[];
    }
  /** A source this build has no rule for. Never treated as open to all. */
  | { type: 'other' };

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
    /**
     * Where the chip opens, as the answer carried it. Absent on a receipt
     * sealed before #4713, which can be reported but not posted.
     */
    target?: unknown;
    /** Whose message a chat chip said it was. Absent on any other chip. */
    author?: string;
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
  given: Array<{
    title: string;
    text: string;
    /** Absent on a receipt sealed before #4713. */
    ref?: AskGivenRef;
    /** What the source is called on a chip ("Bylaws", "Your tasks"). */
    label?: string;
    kind?: string;
  }>;
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
  /**
   * The question came with earlier turns of the conversation (#4713). Those
   * turns are the client's text and were read by the model beside `given`,
   * so nothing here says where they came from: such an answer can be
   * reported, never posted to a channel. Absent when there were none.
   */
  followed_up?: true;
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

/**
 * Catch me up's report receipt (#3946). The same idea as Ask's: a summary is
 * stored nowhere, so the exchange is sealed into the response and kept only
 * if the member hands it back with a report. Bound to the reader and the
 * chapter, and good for as long as Ask's.
 */
export const CHAT_SUMMARY_REPORT_RECEIPT_VERSION = 1;

export interface ChatSummaryReportReceipt {
  v: typeof CHAT_SUMMARY_REPORT_RECEIPT_VERSION;
  summary_id: string;
  issued_at: string;
  channel_id: string;
  /** Set when the summary was of one thread. */
  thread_root_id: string | null;
  /** The conversation as the model was handed it. */
  given: string;
  /** What the model wrote, before Frapp's checks changed what was shown. */
  written: Array<{
    kind: string;
    text: string;
    message: string;
    quote: string;
  }>;
  /** What the member was shown. */
  shown: {
    points: Array<{
      kind: string;
      text: string;
      message_id: string;
      quote: string;
    }>;
    messages_read: number;
    messages_total: number;
    left_out_messages: number;
    unverified_points: number;
  };
  model: string;
  prompt_version: string;
  /** The members whose messages are in `given`, other than the reader. */
  quoted_user_ids: string[];
}

function chatSummaryReceiptContext(chapterId: string, userId: string): string {
  return `chat-summary-report-receipt:${chapterId}:${userId}`;
}

/** Seals a receipt, or returns null when there is no key to seal with. */
export function sealChatSummaryReportReceipt(
  ring: AiTextKeyRing | null,
  receipt: ChatSummaryReportReceipt,
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
    chatSummaryReceiptContext(binding.chapterId, binding.userId),
  );
}

/**
 * Opens a summary's receipt handed back with a report. Throws as
 * {@link openAskReportReceipt} does: `invalid`, `expired`, or the cipher's
 * `no_key`.
 */
export function openChatSummaryReportReceipt(
  ring: AiTextKeyRing | null,
  envelope: string,
  binding: { chapterId: string; userId: string },
  now: Date,
): ChatSummaryReportReceipt {
  let packed: string;
  try {
    packed = openAiText(
      ring,
      envelope,
      chatSummaryReceiptContext(binding.chapterId, binding.userId),
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
  let receipt: ChatSummaryReportReceipt;
  try {
    receipt = JSON.parse(
      inflateRawSync(
        Buffer.from(packed.slice(PLAINTEXT_PREFIX.length), 'base64'),
      ).toString('utf8'),
    ) as ChatSummaryReportReceipt;
  } catch {
    throw new AskReportReceiptError('invalid');
  }
  if (receipt?.v !== CHAT_SUMMARY_REPORT_RECEIPT_VERSION) {
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
