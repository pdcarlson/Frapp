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
