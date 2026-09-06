import { ChapterAuditLog } from '../entities/chapter-audit-log.entity';

export const CHAPTER_AUDIT_LOG_REPOSITORY = 'CHAPTER_AUDIT_LOG_REPOSITORY';

/**
 * Cursor-paginated, filtered read of a chapter's audit trail, newest first.
 *
 * Every filter is optional and they compose as an intersection; an empty set
 * degrades to the same query an unfiltered read runs. `before` is the cursor
 * and is separate from the `startDate`/`endDate` window on purpose — the
 * window stays fixed while the cursor walks down it.
 */
export interface ListChapterAuditLogOptions {
  /** ISO timestamp; only rows strictly older than this instant are returned. */
  before?: string;
  /** Restrict to entries written by this actor. Never matches system rows, whose actor is null. */
  actorUserId?: string;
  /** Exact match on the action verb. */
  action?: string;
  /** Inclusive lower bound on `created_at`, as an ISO timestamp. */
  startDate?: string;
  /** Inclusive upper bound on `created_at`, as an ISO timestamp. */
  endDate?: string;
  limit: number;
}

export interface IChapterAuditLogRepository {
  create(data: Partial<ChapterAuditLog>): Promise<ChapterAuditLog>;
  findByChapter(
    chapterId: string,
    options: ListChapterAuditLogOptions,
  ): Promise<ChapterAuditLog[]>;
}
