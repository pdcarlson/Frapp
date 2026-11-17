import type { ChapterDriveConnection } from '../entities/chapter-drive-connection.entity';

export const CHAPTER_DRIVE_REPOSITORY = 'CHAPTER_DRIVE_REPOSITORY';

/** What a sync, or a failed one, writes back to its connection. */
export interface ChapterDriveSyncResult {
  status?: 'active' | 'no_access';
  folder_name?: string;
  last_synced_at?: string;
  last_error?: string | null;
  synced_count?: number;
  skipped_count?: number;
  /** Folders past the depth or folder cap, left unread (#5331). */
  folders_left_out?: number;
  /** Set to bring the next sync forward (more to copy) or push it back. */
  sync_due_at?: string;
}

export interface IChapterDriveRepository {
  /** The chapter's live (not disconnecting) connection. */
  findLive(chapterId: string): Promise<ChapterDriveConnection | null>;
  /** The chapter's connection, a disconnecting one included. */
  findAny(chapterId: string): Promise<ChapterDriveConnection | null>;
  create(data: {
    chapter_id: string;
    folder_id: string;
    folder_name: string;
    connected_by: string;
    who_can_see: string[] | null;
  }): Promise<ChapterDriveConnection>;
  /** Makes the chapter's live connection due now. False when there is none. */
  markDue(chapterId: string, now: Date): Promise<boolean>;
  /** Turns the chapter's live connection `disconnecting`. False when none. */
  disconnect(chapterId: string, now: Date): Promise<boolean>;
  /** Leases due and disconnecting connections to this worker. */
  claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<ChapterDriveConnection[]>;
  /** Writes a sync's result and releases the lease (not on a disconnecting row). */
  finishSync(id: string, result: ChapterDriveSyncResult): Promise<void>;
  /** Releases a lease without a result (the sync broke). */
  releaseLease(id: string): Promise<void>;
  /** Deletes a disconnected connection once its copies are gone. */
  delete(id: string): Promise<void>;
}
