/**
 * System sender id for server-originated chat messages (the welcome post,
 * the `#chapter-audit` bridge, and invite-accept DMs). Must exist in the
 * `users` table — seeded via `supabase/migrations/20260524120000_chapter_directory_requests.sql`,
 * not `supabase/seed.sql`.
 */
export const SYSTEM_SENDER_ID = '00000000-0000-0000-0000-000000000000';
