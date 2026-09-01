import { ChapterAuditLog } from '../entities/chapter-audit-log.entity';

export const CHAPTER_AUDIT_LOG_REPOSITORY = 'CHAPTER_AUDIT_LOG_REPOSITORY';

/** Cursor-paginated read of a chapter's audit trail, newest first. */
export interface ListChapterAuditLogOptions {
  /** ISO timestamp; only rows strictly older than this instant are returned. */
  before?: string;
  limit: number;
}

export interface IChapterAuditLogRepository {
  create(data: Partial<ChapterAuditLog>): Promise<ChapterAuditLog>;
  findByChapter(
    chapterId: string,
    options: ListChapterAuditLogOptions,
  ): Promise<ChapterAuditLog[]>;
}
