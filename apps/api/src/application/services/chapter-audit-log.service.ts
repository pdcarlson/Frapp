import { Inject, Injectable } from '@nestjs/common';
import {
  CHAPTER_AUDIT_LOG_REPOSITORY,
  type IChapterAuditLogRepository,
} from '../../domain/repositories/chapter-audit-log.repository.interface';
import { ChapterAuditLog } from '../../domain/entities/chapter-audit-log.entity';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '../../domain/constants/list-query-limits';

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
  constructor(
    @Inject(CHAPTER_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepo: IChapterAuditLogRepository,
  ) {}

  // Append-only audit trail. A failed write must fail the request — settings
  // and roster changes are never silently unaudited (matches the existing
  // writers' convention).
  async record(entry: RecordAuditEntryInput): Promise<void> {
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
  }

  async list(
    chapterId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChapterAuditLog[]> {
    const limit = Math.max(
      LIST_QUERY_LIMIT_MIN,
      Math.min(options.limit ?? LIST_QUERY_LIMIT_DEFAULT, LIST_QUERY_LIMIT_MAX),
    );

    let beforeIso: string | undefined;
    if (options.before) {
      const parsed = new Date(options.before);
      if (!Number.isNaN(parsed.getTime())) {
        beforeIso = parsed.toISOString();
      }
    }

    return this.auditLogRepo.findByChapter(chapterId, {
      before: beforeIso,
      limit,
    });
  }
}
