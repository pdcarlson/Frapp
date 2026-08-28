/**
 * An append-only record of an officer action, persisted to
 * `chapter_audit_log` (`20260523130000_audit_log.sql`).
 *
 * The table has no `updated_at` by design — RLS policies deny UPDATE and
 * DELETE outright, so a row is written once and never revised. The
 * ChatBridgeWorker subscribes to INSERTs here and mirrors member-visible
 * entries into `#chapter-audit` (ADR-08).
 */
export interface ChapterAuditLog {
  id: string;
  chapter_id: string;
  /** Null once the acting user is deleted (`on delete set null`). */
  actor_user_id: string | null;
  /** Verb, e.g. `chapter_config_updated`. */
  action: string;
  target_type: string;
  /** Free-form id of the target row; text, not uuid, so non-uuid keys fit. */
  target_id: string | null;
  scope: string;
  /** Before/after payload for the change (jsonb, defaults to `{}`). */
  diff: Record<string, unknown>;
  /** Whether the entry is mirrored to members, or exec-only. */
  member_visible: boolean;
  created_at: string;
}
