import { z } from "zod";
import { CHAT_MESSAGE_CONTENT_MAX_LENGTH } from "./field-limits";

// ── Chat message schemas (Chunk 02; hot-path moved to NestJS in #416)
// Originally shared with the Deno Edge Functions, which no longer import it.
// (Corrected 2026-11-12: this said the code was kept zod-only so a Deno
// consumer could import it through an import map. It also imports
// `./field-limits` by an extensionless path, which an import map doesn't
// resolve.) ──────

/**
 * `users.id` of the system actor behind server-originated chat messages — the
 * chapter welcome post, the `#chapter-audit` bridge, invite-accept DMs and the
 * poll-expiry notice. A real seeded `users` row
 * (`supabase/migrations/20260524120000_chapter_directory_requests.sql`).
 *
 * Canonical here rather than in the API so clients read the same value the
 * server enforces: `spec/behavior/chat/README.md` § Block makes the system
 * actor unblockable (`ChatBlockService` refuses it with a 400), and a client
 * offering "Block" on a system message would be a dead control. The API's
 * `domain/constants/chat.ts` re-exports this rather than keeping a copy.
 */
export const SYSTEM_SENDER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The author name for a message the server posts as the system actor
 * (`SYSTEM_SENDER_ID`): the chapter welcome post, the `#chapter-audit` bridge,
 * poll-expiry notices and invite-accept DMs.
 *
 * The system actor is a real `users` row but never a chapter member, so the
 * roster can't name it, and before this the clients' author line fell through
 * to `memberFallbackLabel` and the welcome post every new chapter sees first read
 * "Member 000000" beside a "00" avatar (#3347). It is the product speaking, so
 * it takes the product's name. The row's own `display_name` ("Frapp System")
 * is not used: it names the account, not the voice, and the roster never
 * serves it anyway. `@repo/hooks`' `resolveAuthorName` and the API's activity
 * feed both read this.
 */
export const SYSTEM_AUTHOR_LABEL = "Frapp";

/**
 * Where a client's read of its own chat block list stands
 * (`spec/behavior/chat/README.md` § The masking contract). Tri-state, never
 * boolean: a failed read that looked like "nobody is blocked" would fail open
 * on a safety feature — the exact defect #2315 records.
 *
 * Canonical here because two packages that may not import each other share
 * it: `@repo/hooks`' `useBlockedUserIds` produces it, and `@repo/chat-core`'s
 * classifier (`blocks.ts`) consumes it.
 */
export type BlockListStatus = "ready" | "loading" | "unavailable";

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "rush",
  "system_audit",
  "imported",
  "loading",
  "announcement",
  "signup",
] as const;

export const SendChatMessageSchema = z.object({
  /**
   * Client-generated idempotency key (UUID or UUID-like string).
   * The server dedupes on (channel_id, sender_id, client_message_id).
   * Actor identity is resolved from the authenticated session — never from
   * this payload.
   */
  client_message_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  content: z.string().min(1).max(CHAT_MESSAGE_CONTENT_MAX_LENGTH),
  kind: z.enum(CHAT_MESSAGE_KINDS).default("text"),
  payload: z.record(z.string(), z.unknown()).optional(),
  reply_to_id: z.string().uuid().optional(),
});
