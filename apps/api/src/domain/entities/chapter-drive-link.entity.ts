/**
 * One Google Drive file added to Documents by its link (#5434;
 * `spec/behavior/chapter-docs.md` § Google Drive file by link). The worker's
 * side of a linked document: the document itself carries what members see
 * (`drive_link_status`, `drive_synced_at`). Deleting the document deletes it.
 */
export interface ChapterDriveLink {
  id: string;
  chapter_id: string;
  /** The linked document. */
  document_id: string;
  /** The Drive file's id. */
  file_id: string;
  /**
   * The `resourcekey` a link to some older files shared by link carries, which
   * Google needs alongside the id. Null for most files.
   */
  resource_key: string | null;
  /** Who added it; the document is filed as uploaded by them. */
  linked_by: string;
  /**
   * Whether the chapter proved the file is its own with the connect code
   * (#5185). False for a file added because anyone with the link could open
   * it: it stops syncing once that ends, so a file later shared with Frapp by
   * someone else never flows into this chapter.
   */
  proven: boolean;
  sync_due_at: string;
  sync_lease_until: string | null;
  /** A short reason the last check failed, never Google's response body. */
  last_error: string | null;
  created_at: string;
}
