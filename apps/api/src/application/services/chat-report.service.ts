import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMessageReportRepository } from '#domain/repositories/chat-moderation.repository.interface';
import type {
  ChatMessageReportView,
  ChatReportReason,
  ChatReportResolutionStatus,
  ChatReportStatus,
} from '#domain/entities/chat-moderation.entity';
import { ChannelAccessService } from './channel-access.service';

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
 * Member-filed reports against chat messages (#2257), per
 * `spec/behavior/chat/README.md` § Report and block. App Store Guideline 1.2
 * expects a UGC app to let a member report objectionable content; officer
 * moderation (`channels:manage`) already exists but does not reach a private DM,
 * which is the surface a reviewer probes and the one a harassed member needs.
 */
@Injectable()
export class ChatReportService {
  constructor(
    @Inject(CHAT_MESSAGE_REPORT_REPOSITORY)
    private readonly reportRepo: IChatMessageReportRepository,
    private readonly channelAccess: ChannelAccessService,
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

    return this.reportRepo.create({
      chapter_id: chapterId,
      message_id: input.message_id,
      reporter_user_id: reporterUserId,
      reported_content: message.content,
      reported_sender_id: message.sender_id,
      reported_author_name: message.author_name ?? null,
      reason: input.reason,
      details: input.details ?? null,
    });
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
