import type { ChapterDriveLink } from '../entities/chapter-drive-link.entity';

export const CHAPTER_DRIVE_LINK_REPOSITORY = 'CHAPTER_DRIVE_LINK_REPOSITORY';

/**
 * Google Drive files added to Documents by link (#5434). Reads and writes are
 * scoped by chapter, except the worker's `claim` and its writes back to rows
 * it leased.
 */
export interface IChapterDriveLinkRepository {
  create(data: {
    chapter_id: string;
    document_id: string;
    file_id: string;
    resource_key: string | null;
    linked_by: string;
    proven: boolean;
  }): Promise<ChapterDriveLink>;
  /** The link behind a document in the chapter, or null. */
  findByDocument(
    documentId: string,
    chapterId: string,
  ): Promise<ChapterDriveLink | null>;
  /** Makes a link due now. False when the chapter has no such link. */
  markDue(documentId: string, chapterId: string, now: Date): Promise<boolean>;
  /** Leases due links to this worker; each is next due in 15 minutes. */
  claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<ChapterDriveLink[]>;
  /** Writes a check's error (or clears it) and releases the lease. */
  finish(
    id: string,
    result: { last_error: string | null; sync_due_at?: string },
  ): Promise<void>;
}
