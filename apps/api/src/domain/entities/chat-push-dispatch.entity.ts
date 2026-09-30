/**
 * The push worker's per-message claim, persisted to `chat_push_dispatches`
 * (`20260930020000_chat_push_dispatches.sql`, #2846).
 *
 * One row per `chat_messages` row the worker fans out. The primary key is the
 * dedup mechanism: every API instance receives every Realtime INSERT, and only
 * the one whose insert wins sends the pushes. A losing insert raises `23505`
 * and means "another instance owns this message", not an error.
 *
 * API-only (service role). Rows older than a day are purged hourly.
 */
export interface ChatPushDispatch {
  message_id: string;
  dispatched_at: string;
}
