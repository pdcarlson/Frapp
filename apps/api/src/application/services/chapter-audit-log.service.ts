import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  CHAPTER_AUDIT_LOG_REPOSITORY,
  type IChapterAuditLogRepository,
} from '#domain/repositories/chapter-audit-log.repository.interface';
import { ChapterAuditLog } from '#domain/entities/chapter-audit-log.entity';
import { clampListLimit } from '#domain/constants/list-query-limits';
import {
  ISO_INSTANT_MESSAGE,
  parseIsoInstant,
} from '#domain/constants/iso-instant';

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

/** Caller-facing options for {@link ChapterAuditLogService.list}. */
export interface ListChapterAuditLogInput {
  before?: string;
  actorUserId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * Epoch milliseconds for a caller-supplied bound, or `undefined` when the
 * caller omitted it. A value that is present but not a valid instant is a
 * 400 — never a silent drop.
 *
 * Silently dropping is what the `before` cursor used to do, and it is the
 * wrong answer for any of these: a dropped bound WIDENS the result set, so
 * the caller gets rows outside the window they asked for, behind a `200`,
 * with no way to tell. A dropped cursor re-serves the page they already had.
 * The DTO rejects these shapes first; this is the guard for a direct call.
 */
function instantOrThrow(label: string, value?: string): number | undefined {
  if (value === undefined) return undefined;
  const epoch = parseIsoInstant(value);
  if (epoch === null) {
    throw new BadRequestException(`${label} ${ISO_INSTANT_MESSAGE}`);
  }
  return epoch;
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
    options: ListChapterAuditLogInput = {},
  ): Promise<ChapterAuditLog[]> {
    const limit = clampListLimit(options.limit);

    // Parsed ONLY to validate and compare. Every timestamp reaches the
    // repository as the caller's original string: `new Date(x).toISOString()`
    // truncates a `timestamptz`'s microseconds to milliseconds, which can drop
    // a same-millisecond row off the created_at cursor.
    instantOrThrow('before', options.before);
    const startsAt = instantOrThrow('start_date', options.startDate);
    const endsAt = instantOrThrow('end_date', options.endDate);

    // An inverted window is a client error, not an empty result. Postgres
    // would accept it happily and return zero rows, which reads as "nothing
    // happened in this chapter" rather than "your filter is backwards".
    // Compared as instants, never as strings: two timestamps naming the same
    // moment can differ textually ('…Z' vs '…+00:00'), so lexicographic order
    // is not a total order over valid input.
    if (startsAt !== undefined && endsAt !== undefined && startsAt > endsAt) {
      throw new BadRequestException('start_date must not be after end_date');
    }

    return this.auditLogRepo.findByChapter(chapterId, {
      before: options.before,
      actorUserId: options.actorUserId,
      action: options.action,
      startDate: options.startDate,
      endDate: options.endDate,
      limit,
    });
  }
}
