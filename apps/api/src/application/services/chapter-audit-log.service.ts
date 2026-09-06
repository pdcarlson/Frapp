import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHAPTER_AUDIT_LOG_REPOSITORY,
  type IChapterAuditLogRepository,
} from '#domain/repositories/chapter-audit-log.repository.interface';
import { ChapterAuditLog } from '#domain/entities/chapter-audit-log.entity';
import { clampListLimit } from '#domain/constants/list-query-limits';

export interface RecordAuditEntryInput {
  chapterId: string;
  /** Null when the acting identity is the system itself, not a member. */
  actorUserId: string | null;
  /** Verb, e.g. `member_removed`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Before/after payload for the change. Defaults to `{}`. */
  diff?: Record<string, unknown>;
  /** Whether the entry is mirrored to `#chapter-audit`, or exec-only. Defaults to `true`. */
  memberVisible?: boolean;
}

/**
 * Shared write/read path for `chapter_audit_log` (Chunk 02, #334).
 *
 * The three original writers (`chapter-config`, `custom-role`,
 * `custom-field` services) each still insert inline and are left as-is —
 * this service is for new writers so they don't have to repeat the insert
 * shape. `ChatBridgeWorkerService` mirrors every member-visible row into
 * `#chapter-audit` on its own via a Realtime subscription, so a writer here
 * needs no separate chat call.
 */
@Injectable()
export class ChapterAuditLogService {
  private readonly logger = new Logger(ChapterAuditLogService.name);

  constructor(
    @Inject(CHAPTER_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepo: IChapterAuditLogRepository,
  ) {}

  // Append-only audit trail. A failed write must fail the request — settings
  // and roster changes are never silently unaudited (matches the existing
  // writers' convention). Logged before rethrowing so "the mutation
  // succeeded but its audit entry didn't land" has a specific signal to
  // triage on, rather than reading as a bare 500 (matches
  // chapter-config.service.ts's writeAudit).
  async record(entry: RecordAuditEntryInput): Promise<void> {
    try {
      await this.auditLogRepo.create({
        chapter_id: entry.chapterId,
        actor_user_id: entry.actorUserId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId ?? null,
        scope: 'chapter',
        diff: entry.diff ?? {},
        member_visible: entry.memberVisible ?? true,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write chapter_audit_log entry (action=${entry.action}, chapter=${entry.chapterId})`,
        error as Error,
      );
      throw error;
    }
  }

  async list(
    chapterId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChapterAuditLog[]> {
    const limit = clampListLimit(options.limit);

    // Validated, not reformatted: `new Date(x).toISOString()` truncates a
    // `timestamptz`'s microsecond precision to milliseconds, which can drop
    // a same-millisecond row off this created_at-only cursor. The DTO already
    // rejects non-ISO8601 input; this only guards a directly-called `before`
    // (e.g. from a test) against reaching Postgres as a malformed literal.
    const before =
      options.before && !Number.isNaN(new Date(options.before).getTime())
        ? options.before
        : undefined;

    return this.auditLogRepo.findByChapter(chapterId, { before, limit });
  }
}
