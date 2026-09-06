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
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { ChapterAuditLog } from '#domain/entities/chapter-audit-log.entity';
import { SystemRoleKeys } from '#domain/constants/permissions';
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
 * Who is reading. Only the seeded-role ids matter: exec-only rows are visible
 * to the chapter's President and nobody else, and the President is identified
 * by holding the chapter's `system_key = 'PRESIDENT'` role — the one role that
 * may carry the wildcard — never by a permission a custom role could be minted
 * with.
 */
export interface AuditLogViewer {
  roleIds: readonly string[];
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
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
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

  /**
   * Read the chapter's history as one caller sees it.
   *
   * **Every caller who is not the President sees only `member_visible` rows.**
   * This is the filter `20260523130000_audit_log.sql` says the API applies in
   * place of a SELECT policy (#1773), and it is what makes the president-only
   * `member_visible` toggle in `spec/behavior/settings/README.md` § Audit Rules
   * mean something: toggling a row off retracts its `#chapter-audit` mirror for
   * non-presidents, and it must retract the row from this read too, or a
   * custom role holding `chapter-config:view` + `members:view` could ask
   * `?action=member_removed` for exactly what was just hidden.
   *
   * "President" is the member holding the chapter's seeded President role,
   * resolved by `system_key` against THIS chapter — a stale or cross-chapter
   * role id on the member row resolves to nothing and reads as a member.
   * A chapter with no President role (mid presidency-transfer, or an orphaned
   * chapter) has no exec-only readers until one exists; failing closed is the
   * right side of that edge.
   */
  async list(
    chapterId: string,
    viewer: AuditLogViewer,
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

    const memberVisibleOnly = !(await this.isPresident(chapterId, viewer));

    return this.auditLogRepo.findByChapter(chapterId, {
      before: options.before,
      actorUserId: options.actorUserId,
      action: options.action,
      startDate: options.startDate,
      endDate: options.endDate,
      memberVisibleOnly,
      limit,
    });
  }

  private async isPresident(
    chapterId: string,
    viewer: AuditLogViewer,
  ): Promise<boolean> {
    if (viewer.roleIds.length === 0) return false;
    const presidentRole = await this.roleRepo.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.PRESIDENT,
    );
    return presidentRole !== null && viewer.roleIds.includes(presidentRole.id);
  }
}
