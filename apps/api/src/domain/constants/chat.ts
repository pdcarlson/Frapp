/**
 * System sender id for server-originated chat messages (the welcome post,
 * the `#chapter-audit` bridge, and invite-accept DMs). Must exist in the
 * `users` table — seeded via `supabase/migrations/20260524120000_chapter_directory_requests.sql`,
 * not `supabase/seed.sql`.
 *
 * Re-exported from `@repo/validation`, which owns the value, so the mobile and
 * web clients that hide "Block" on a system message read the same id the
 * server's block guard refuses rather than a copy that could drift.
 */
export { SYSTEM_SENDER_ID } from '@repo/validation';

/**
 * The most a chat message's client-sent `metadata` may hold, serialized
 * (`SendMessageDto.metadata`). No app sends any today: the keys a message
 * carries there (`attachment_count`, `attachment_photos`, `gif`,
 * `mention_picks`) are the server's own, written after a client's copies are
 * dropped. Every reader of the channel downloads the row, so the field is
 * bounded as `content` is.
 */
export const CHAT_MESSAGE_METADATA_MAX_CHARS = 16_384;

/**
 * The most a chat card's `payload` may hold, serialized, once the send has
 * checked it (`ChatService.sendMessage`). A form has its own, below. Measured
 * against what the apps build with every field at its limit: a sign-up sheet
 * about 5,000 characters, an announcement about 4,000, a poll about 2,900, a
 * role picker about 1,200. Server-built cards (`system_originated`) are not
 * held to it.
 */
export const CHAT_CARD_PAYLOAD_MAX_CHARS = 16_384;

/**
 * The same bound for a form card (#3926 step 3), which holds more: its
 * questions and their options. A long rush interest form, 25 questions with
 * ten of them multiple choice, is about 13,000 characters, and this leaves
 * several times that: a chapter's real forms never reach it. Every field's
 * own limit still applies (`normalizeFormCard`); this bounds the card as a
 * whole, which every reader of the channel downloads.
 */
export const CHAT_FORM_CARD_PAYLOAD_MAX_CHARS = 65_536;

/**
 * The most people in a group DM, its creator included
 * (`spec/behavior/chat/README.md` § Direct Messages: "up to 10").
 */
export const MAX_GROUP_DM_MEMBERS = 10;
