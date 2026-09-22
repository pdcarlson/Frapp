import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMessageReportRepository } from '#domain/repositories/chat-moderation.repository.interface';
import type {
  ChatMessageReportView,
  ChatReportReason,
  ChatReportResolutionStatus,
  ChatReportStatus,
} from '#domain/entities/chat-moderation.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import {
  ChannelAccessService,
  ReportedMessageGrant,
} from './channel-access.service';
import { ChatService } from './chat.service';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { RbacService } from './rbac.service';

/**
 * What the controller hands this service to file a report. Declared here rather
 * than imported from `interface/` because the application layer may not depend
 * on the interface layer (dependency-cruiser `api-application-not-to-interface`);
 * `interface/dtos/service-input-coverage.ts` is the compile-only proof that the
 * DTO and this type have not drifted.
 */
export interface FileChatReportInput {
  message_id: string;
  reason: ChatReportReason;
  details?: string;
}

/**
 * Who is told that a report was filed: whoever the officer queue would admit.
 *
 * Spelled as the queue route's full `@RequirePermissions` union —
 * `ChatReportController`'s class-level `members:view` AND the handler's
 * `channels:manage` — so the notified set and the set that can open the queue
 * cannot drift apart. A member holding only `channels:manage` would otherwise be
 * paged about a queue that answers them 403.
 */
export const REPORT_QUEUE_PERMISSIONS = [
  SystemPermissions.MEMBERS_VIEW,
  SystemPermissions.CHANNELS_MANAGE,
] as const;

/**
 * The officer notification for a newly filed report (#2257).
 *
 * **Content-free, deliberately.** A push is text on a lock screen and a
 * persisted `notifications` row, outside every access check the queue applies.
 * So it carries no message text (which may be the very content being reported,
 * from a DM the officer cannot read), no reporter (the queue itself never
 * discloses one — `stripReportRow`), and no reported member (a name on a lock
 * screen is an accusation before anyone has reviewed it). The queue is where an
 * officer learns what was reported; this only says that something was.
 *
 * - **`admin` category**, not `chat`: this is chapter operations, like "new
 *   member joined", and must not be silenced by the Chat switch that governs a
 *   member's own messages. `admin` has no member-facing switch
 *   (`NOTIFICATION_CATEGORIES` in `@repo/validation` omits it on purpose).
 * - **NORMAL**, not URGENT: a report is not a chapter emergency, and NORMAL
 *   keeps quiet hours in force. URGENT is reserved for traffic a member may not
 *   mute at all (`spec/behavior/notifications.md` § Delivery Flow).
 * - **`chat_reports` target**, a bare screen naming the officer queue. Web
 *   resolves it to `/chat-admin`; mobile has no queue and falls through to the
 *   notification list, as it does for any screen it does not route.
 */
export const REPORT_FILED_NOTIFICATION: NotifyPayload = {
  title: 'Message Reported',
  body: 'A chat message was reported and is waiting in the report queue.',
  priority: 'NORMAL',
  category: 'admin',
  data: { target: { screen: 'chat_reports' } },
};

/**
 * Member-filed reports against chat messages (#2257), per
 * `spec/behavior/chat/README.md` § Report and block. App Store Guideline 1.2
 * expects a UGC app to let a member report objectionable content; officer
 * moderation (`channels:manage`) does not reach a private DM on its own, so the
 * report is what carries it there — one message at a time
 * ({@link ChatReportService.removeReportedMessage}, #2311).
 */
@Injectable()
export class ChatReportService {
  private readonly logger = new Logger(ChatReportService.name);

  constructor(
    @Inject(CHAT_MESSAGE_REPORT_REPOSITORY)
    private readonly reportRepo: IChatMessageReportRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatService: ChatService,
    private readonly rbac: RbacService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * File a report as the caller.
   *
   * **Authorized as a READ of the message's channel, never with ambient service
   * authority.** `assertMessageAccess` resolves message → channel → chapter and
   * delegates to `ChannelAccessService.assertChannelAccess` at
   * `operation: 'read'`, so the set of reportable messages is exactly the set
   * the member could already render — a message in a private channel or a DM
   * they are not in is a 403, and one outside their chapter is normalized to a
   * 404 so the two cannot be told apart. `'read'` rather than `'post'` is
   * deliberate for the same reason bookmarks use it: reporting is not authoring
   * channel content, and a member must be able to report in a read-only channel
   * (`#announcements`) they can read but cannot write to.
   *
   * The reporter is `@CurrentUser('id')`, threaded from the guard chain. No
   * route accepts a reporter id, so a member cannot report as someone else.
   *
   * **The evidence is snapshotted here, from the row we just authorized.** Both
   * author columns are copied, not only `sender_id`: `chat_messages` enforces
   * `sender_id is not null or author_name is not null`, so a Discord-imported
   * row names its author in `author_name` with a NULL `sender_id`. Mirroring
   * `sender_id` alone would snapshot nobody for exactly the rows the import
   * purge later hard-deletes, leaving an officer with content and no author.
   *
   * Idempotency is the repository's: a second report on the same message while
   * the first is still `open` returns that first report instead of surfacing the
   * partial unique index as a 500. Once a report is resolved the message can be
   * reported again — a link dismissed as spam and then edited into harassment is
   * a new report, not a duplicate.
   *
   * **Officers are notified of a new report, and only a new one** — see
   * {@link notifyOfficers}. A replay returns the existing report silently, so a
   * double-tap or an offline retry cannot page the moderation team twice.
   */
  async fileReport(
    chapterId: string,
    reporterUserId: string,
    input: FileChatReportInput,
  ): Promise<ChatMessageReportView> {
    const message = await this.channelAccess.assertMessageAccess(
      input.message_id,
      chapterId,
      reporterUserId,
    );

    const { report, created } = await this.reportRepo.create({
      chapter_id: chapterId,
      message_id: input.message_id,
      reporter_user_id: reporterUserId,
      reported_content: message.content,
      reported_sender_id: message.sender_id,
      reported_author_name: message.author_name ?? null,
      reason: input.reason,
      details: input.details ?? null,
    });

    if (created) {
      await this.notifyOfficers(chapterId, report, reporterUserId);
    }

    return report;
  }

  /**
   * Tell the chapter's moderators that a report is waiting.
   *
   * Guideline 1.2 asks a UGC app to stand behind a *timely* response to a
   * report, and a queue nobody is told about gets read whenever an officer
   * happens to open it. So a new report pings every member the queue would
   * admit ({@link REPORT_QUEUE_PERMISSIONS}, the wildcard included), with two
   * exclusions:
   *
   * - **The reported sender.** An officer can be reported like anyone else, and
   *   paging them about it tells the reported member they were reported — the
   *   disclosure the rest of this feature is built to avoid. Their permission is
   *   unchanged and the queue stays open to them; they are only not pinged by
   *   the act of being reported. Null for an imported archive row.
   * - **The reporter.** They know; a push about their own action is noise.
   *
   * **Never fails the report.** The row is committed before this runs, and the
   * member who filed it must get their success whether or not the roster read
   * or a push works — a 500 here would invite a retry that the idempotent path
   * then answers silently, so the officers would never hear. Each recipient is
   * sent independently (`allSettled`), so one officer's failing delivery does
   * not cost the others their notification.
   */
  private async notifyOfficers(
    chapterId: string,
    report: ChatMessageReportView,
    reporterUserId: string,
  ): Promise<void> {
    try {
      const officerIds = await this.rbac.findUserIdsWithPermissions(
        chapterId,
        REPORT_QUEUE_PERMISSIONS,
      );
      const excluded = new Set<string>([reporterUserId]);
      if (report.reported_sender_id) excluded.add(report.reported_sender_id);
      const recipients = officerIds.filter((id) => !excluded.has(id));

      const results = await Promise.allSettled(
        recipients.map((officerId) =>
          this.notificationService.notifyUser(
            officerId,
            chapterId,
            REPORT_FILED_NOTIFICATION,
          ),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        this.logger.warn('Some officers were not notified of a chat report', {
          reportId: report.id,
          chapterId,
          failed,
          recipients: recipients.length,
        });
      }
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Could not notify officers of chat report ${report.id}`,
        error,
      );
    }
  }

  /**
   * Remove the one message an open report names, and mark the report
   * `actioned` (#2311, option 1 — owner decision 2026-09-22).
   *
   * **The report row is the capability.** It is read here scoped to the
   * caller's chapter, so a report from another chapter is the same 404 as no
   * report at all; {@link ReportedMessageGrant.fromOpenReport} then refuses a
   * resolved report, or one whose message is gone, with a 409; and the grant it
   * mints names exactly the `message_id` this read returned. The route takes a
   * report id and nothing else — the client never names the message, so there
   * is no second id to point at a sibling.
   *
   * **Order: remove, then resolve.** Resolving first would leave an `actioned`
   * report over a message still in place whenever the delete then failed (a
   * message its sender already deleted is a 409 by design) — a false statement
   * in the moderation record. Removing first makes the worst case the reverse,
   * message gone and report still open, which the officer sees and closes. Two
   * officers acting on one report at the same moment can both pass the open
   * check; the later resolve then stamps `actioned`, which is what happened to
   * the message.
   */
  async removeReportedMessage(
    reportId: string,
    chapterId: string,
    officerUserId: string,
  ): Promise<ChatMessageReportView> {
    const report = await this.reportRepo.findById(reportId, chapterId);
    if (!report) throw new NotFoundException('Report not found');

    const grant = ReportedMessageGrant.fromOpenReport(report);
    await this.chatService.deleteReportedMessage(
      grant,
      chapterId,
      officerUserId,
    );

    return this.resolveReport(report.id, chapterId, 'actioned', officerUserId);
  }

  /**
   * The officer queue for the caller's chapter, newest first.
   *
   * Scoped to one status so the read matches
   * `idx_chat_message_reports_chapter_status`, and defaulted to `open` because
   * that is the queue — the resolved statuses are history, reachable by asking
   * for them.
   *
   * Nothing here resolves the reporter: the repository strips
   * `reporter_user_id` on every exit, so "who reported me" has no answer even
   * for a `channels:manage` holder who is themselves the reported member.
   */
  async listReports(
    chapterId: string,
    status: ChatReportStatus = 'open',
  ): Promise<ChatMessageReportView[]> {
    return this.reportRepo.findByChapterAndStatus(chapterId, status);
  }

  /**
   * Resolve a report: status, `resolved_at`, and the officer who did it.
   *
   * The chapter predicate lives on the UPDATE itself rather than in a read-then-
   * write: `channels:manage` says the caller may moderate *their* chapter, and a
   * report id is a bare UUID, so an id-only update would let an officer close
   * another chapter's report. A miss — wrong chapter, or no such report — is the
   * same 404 either way, so the endpoint does not confirm that an id exists
   * somewhere else.
   */
  async resolveReport(
    id: string,
    chapterId: string,
    status: ChatReportResolutionStatus,
    resolvedBy: string,
  ): Promise<ChatMessageReportView> {
    const resolved = await this.reportRepo.resolve(
      id,
      chapterId,
      status,
      resolvedBy,
      new Date().toISOString(),
    );
    if (!resolved) throw new NotFoundException('Report not found');
    return resolved;
  }
}
