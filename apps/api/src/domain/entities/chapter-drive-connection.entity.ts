/**
 * A chapter's connected Google Drive folder (#5157;
 * `spec/behavior/chapter-docs.md` § Google Drive folder). At most one live
 * (not `disconnecting`) row per chapter.
 *
 * - `active`: the worker copies the folder's files into Documents and keeps
 *   them matching it.
 * - `no_access`: Google answered that Frapp's service account can't see the
 *   folder (unshared, or deleted). Copies stay as they were; the worker keeps
 *   checking, so sharing it again brings it back.
 * - `disconnecting`: an officer disconnected; the worker removes the copies,
 *   then deletes the row.
 */
export type ChapterDriveConnectionStatus =
  'active' | 'no_access' | 'disconnecting';

export interface ChapterDriveConnection {
  id: string;
  chapter_id: string;
  /** The Drive folder's id. */
  folder_id: string;
  /** The folder's name in Drive, as the last sync read it. */
  folder_name: string;
  /** Who connected it; copies are filed as uploaded by them. */
  connected_by: string;
  status: ChapterDriveConnectionStatus;
  sync_due_at: string;
  sync_lease_until: string | null;
  last_synced_at: string | null;
  /** A short reason the last sync failed, never Google's response body. */
  last_error: string | null;
  /** Files the last finished sync left in Documents. */
  synced_count: number;
  /** Files the last finished sync left out (type, size, or the limit). */
  skipped_count: number;
  created_at: string;
}
