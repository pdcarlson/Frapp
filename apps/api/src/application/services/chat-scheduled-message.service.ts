import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDirectChannel, withoutObjectReplacement } from '@repo/validation';
import { channelAllowsThreads } from '#domain/utils/channel-access';
import {
  CHAT_SCHEDULED_MESSAGE_REPOSITORY,
  type ChatScheduledMessagePatch,
  type IChatScheduledMessageRepository,
} from '#domain/repositories/chat-scheduled-message.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  type IChatChannelRepository,
  type IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import { freeTierWriteAllowed } from '#domain/constants/subscription-grace';
import type {
  ChatScheduledAttachment,
  ChatScheduledMessage,
  ChatScheduledMessageFailure,
} from '#domain/entities/chat-scheduled-message.entity';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';
import { ChatAttachmentService } from './chat-attachment.service';
import { ChatService } from './chat.service';
import { NotificationService } from './notification.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** How far ahead a message may be scheduled. Slack's limit is 120 days too. */
export const SCHEDULE_MAX_AHEAD_MS = 120 * 24 * 60 * 60 * 1000;
/**
 * How far in the past a requested time may be and still count as "now": a
 * preset picked a few seconds before the request lands. Earlier is refused.
 */
export const SCHEDULE_PAST_GRACE_MS = 60 * 1000;
/** Pending messages one member may hold in one chapter. */
export const SCHEDULE_MAX_PENDING = 50;
/** How long one send holds a row before another replica may take it. */
export const SCHEDULE_LEASE_MS = 2 * 60 * 1000;
/** Sends that broke on the way before the row is given up as `send_failed`. */
export const SCHEDULE_MAX_ATTEMPTS = 5;

export interface ScheduleMessageInput {
  channel_id: string;
  content: string;
  mention_picks?: { user_id: string; label: string }[] | null;
  /** Files uploaded through the channel's upload-url, as a live send takes them. */
  attachments?: ChatScheduledAttachment[] | null;
  /** Quote this message, as a live send's `reply_to_id`. */
  reply_to_id?: string | null;
  /** Post inside this message's thread, as a live send's `thread_root_id`. */
  thread_root_id?: string | null;
  send_at: string;
}

export type ScheduledSendOutcome =
  | { outcome: 'sent'; message: ChatMessage }
  | { outcome: 'failed'; reason: ChatScheduledMessageFailure; cause: unknown }
  | { outcome: 'retry'; cause: unknown };

/**
 * Chat messages a member schedules to post later (#4956;
 * `spec/behavior/chat/README.md` § Scheduled messages).
 *
 * Scheduling checks that the author may post in the channel now; the send at
 * the time goes through {@link ChatService.sendMessage} as the author, so it
 * checks again then, and posts with the same pushes and mentions a live post
 * gets. The row's id is the message's `client_message_id`, so a send retried
 * after a crash answers the message already posted.
 *
 * A scheduled message is what the composer holds: text with `@` picks, files
 * already uploaded (#4971), and a quote or a thread. No GIFs or cards. Files
 * live in storage from the moment they are scheduled: the row's message takes
 * them when it posts, and deleting the row deletes them.
 */
@Injectable()
export class ChatScheduledMessageService {
  private readonly logger = new Logger(ChatScheduledMessageService.name);

  constructor(
    @Inject(CHAT_SCHEDULED_MESSAGE_REPOSITORY)
    private readonly repo: IChatScheduledMessageRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly attachmentService: ChatAttachmentService,
    private readonly chat: ChatService,
    private readonly notifications: NotificationService,
  ) {}

  list(
    chapterId: string,
    userId: string,
    channelId?: string,
  ): Promise<ChatScheduledMessage[]> {
    return this.repo.listForAuthor(chapterId, userId, channelId);
  }

  async schedule(
    chapterId: string,
    userId: string,
    memberId: string,
    input: ScheduleMessageInput,
    now = Date.now(),
  ): Promise<ChatScheduledMessage> {
    const attachments = this.attachmentService.validateAttachmentInputs(
      input.attachments ?? [],
      chapterId,
      input.channel_id,
    );
    const content = cleanContent(input.content, attachments.length > 0);
    const sendAt = checkSendAt(input.send_at, now);
    const replyToId = input.reply_to_id ?? null;
    const threadRootId = input.thread_root_id ?? null;
    if (replyToId && threadRootId) {
      throw new BadRequestException(
        'A thread reply cannot also quote-reply; send one or the other',
      );
    }
    // A thread reply authorizes as `thread`, as the live send does (#3785).
    const channel = await this.channelAccess.assertChannelAccess(
      input.channel_id,
      chapterId,
      userId,
      threadRootId ? 'thread' : 'post',
    );
    await this.checkTargets(channel, replyToId, threadRootId);
    // A soft cap: two requests at once may land one over it.
    const pending = await this.repo.countPending(chapterId, userId);
    if (pending >= SCHEDULE_MAX_PENDING) {
      throw new BadRequestException(
        `You can have at most ${SCHEDULE_MAX_PENDING} scheduled messages at once`,
      );
    }
    return this.repo.create({
      chapter_id: chapterId,
      channel_id: input.channel_id,
      user_id: userId,
      member_id: memberId,
      content,
      mention_picks: input.mention_picks ?? null,
      attachments,
      reply_to_id: replyToId,
      thread_root_id: threadRootId,
      send_at: sendAt,
    });
  }

  /**
   * The live send's rules for a quote and a thread root, checked when it is
   * scheduled so a mistake is said now, not by a failed row later. The send
   * checks them again at the time.
   */
  private async checkTargets(
    channel: ChatChannel,
    replyToId: string | null,
    threadRootId: string | null,
  ): Promise<void> {
    if (replyToId) {
      const parent = await this.messageRepo.findById(replyToId);
      if (!parent || parent.channel_id !== channel.id) {
        throw new BadRequestException(
          'reply_to_id must reference a message in the same channel',
        );
      }
      if (parent.thread_root_id) {
        throw new BadRequestException(
          'reply_to_id cannot reference a reply inside a thread',
        );
      }
    }
    if (threadRootId) {
      if (!channelAllowsThreads(channel)) {
        throw new BadRequestException('This channel does not take threads');
      }
      const root = await this.messageRepo.findById(threadRootId);
      if (!root || root.channel_id !== channel.id) {
        throw new BadRequestException(
          'thread_root_id must reference a message in the same channel',
        );
      }
      if (root.thread_root_id || root.kind === 'imported') {
        throw new BadRequestException('This message cannot be threaded');
      }
    }
  }

  /**
   * Changes the text or the time. Editing a failed message puts it back in
   * line, checked against the author's access again as a new one would be.
   */
  async update(
    chapterId: string,
    userId: string,
    id: string,
    input: {
      content?: string | null;
      send_at?: string;
      mention_picks?: { user_id: string; label: string }[] | null;
    },
    now = Date.now(),
  ): Promise<ChatScheduledMessage> {
    const row = await this.requireOwn(chapterId, userId, id);
    // Files can't be changed here; with files, the text may go.
    const hasFiles = row.attachments.length > 0;
    if (input.content === null && !hasFiles) {
      throw new BadRequestException('A scheduled message needs text');
    }
    // A send that posted and then died before deleting the row leaves it
    // here; an edit to it would be lost to the post's replay.
    if (await this.alreadyPosted(row)) {
      throw new ConflictException('This message has already been sent');
    }
    const patch: ChatScheduledMessagePatch = {};
    if (input.content !== undefined) {
      patch.content = cleanContent(input.content ?? '', hasFiles);
      // New text means new picks: the old ones were for the old text.
      patch.mention_picks = input.mention_picks ?? null;
    }
    if (input.send_at !== undefined) {
      patch.send_at = checkSendAt(input.send_at, now);
    } else if (row.status === 'failed') {
      // A failed row's time has passed; it goes out at the next sweep.
      patch.send_at = new Date(
        Math.max(now, Date.parse(row.send_at)),
      ).toISOString();
    }
    await this.channelAccess.assertChannelAccess(
      row.channel_id,
      chapterId,
      userId,
      row.thread_root_id ? 'thread' : 'post',
    );
    const updated = await this.repo.updateForAuthor(
      chapterId,
      userId,
      id,
      patch,
      new Date(now).toISOString(),
    );
    if (!updated) {
      throw new ConflictException(
        'This message is being sent right now and can no longer be changed',
      );
    }
    return updated;
  }

  /**
   * Refused (409) while a send holds it: it may already be posting. Its
   * uploaded files go with it, unless a message posted from an earlier send
   * of it already has them (a send that posted and died before deleting the
   * row), or something else names them.
   */
  async remove(
    chapterId: string,
    userId: string,
    id: string,
    now = Date.now(),
  ): Promise<void> {
    const deleted = await this.repo.deleteForAuthor(
      chapterId,
      userId,
      id,
      new Date(now).toISOString(),
    );
    if (deleted.outcome === 'missing') {
      throw new NotFoundException('Scheduled message not found');
    }
    if (deleted.outcome === 'held') {
      throw new ConflictException(
        'This message is being sent right now and can no longer be deleted',
      );
    }
    await this.discardFiles(deleted.row);
  }

  private async discardFiles(row: ChatScheduledMessage): Promise<void> {
    if (row.attachments.length === 0) return;
    const context = { scheduledMessageId: row.id };
    let keep: string[];
    try {
      keep = await this.repo.findPathsInUse(
        row.chapter_id,
        row.attachments.map((attachment) => attachment.storage_path),
        row.id,
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-scheduled-message-discard-files',
        message: `Could not check the files of deleted scheduled message ${row.id}; keeping them`,
        error,
      });
      return;
    }
    // `findSharedObjects` finds the files of a message an earlier send of
    // this row posted, so those are kept too.
    await this.attachmentService.discardUnsentAttachments(
      row.attachments,
      keep,
      context,
    );
  }

  /**
   * Posts it now instead of at its time. A refusal (the author can no longer
   * post there) marks it failed and answers with the refusal.
   */
  async sendNow(
    chapterId: string,
    userId: string,
    id: string,
    now = Date.now(),
  ): Promise<ChatMessage> {
    const row = await this.requireOwn(chapterId, userId, id);
    if (row.status !== 'pending') {
      throw new ConflictException(
        'Edit this message to send it again; it did not post at its time',
      );
    }
    const claimed = await this.repo.claim(
      row,
      new Date(now + SCHEDULE_LEASE_MS).toISOString(),
      new Date(now).toISOString(),
    );
    if (!claimed) {
      throw new ConflictException('This message is already being sent');
    }
    const result = await this.deliver(claimed);
    if (result.outcome === 'sent') return result.message;
    throw result.cause;
  }

  /**
   * One send of a row this process has claimed. Posts it as its author and
   * deletes the row; a refusal marks it failed and tells the author; anything
   * else leaves it for the lease to run out and the sweep to try again, until
   * {@link SCHEDULE_MAX_ATTEMPTS}.
   */
  async deliver(row: ChatScheduledMessage): Promise<ScheduledSendOutcome> {
    let message: ChatMessage;
    try {
      // A send before this one may have posted it and died before deleting
      // the row: answer that post rather than judging the send again.
      const posted = row.attempts > 1 ? await this.alreadyPosted(row) : null;
      if (posted) {
        await this.repo.removeSent(row);
        return { outcome: 'sent', message: posted };
      }
      // `ChapterGuard`'s billing lock, which a live post meets on its way in
      // and the sweep never passes through.
      const chapter = await this.chapterRepo.findById(row.chapter_id);
      if (
        chapter &&
        !freeTierWriteAllowed(
          chapter.subscription_status,
          chapter.past_due_since,
        )
      ) {
        await this.fail(row, 'chapter_locked');
        return {
          outcome: 'failed',
          reason: 'chapter_locked',
          cause: new ForbiddenException('This chapter is read-only'),
        };
      }
      ({ message } = await this.chat.sendMessage({
        chapter_id: row.chapter_id,
        channel_id: row.channel_id,
        sender_id: row.user_id,
        content: row.content,
        client_message_id: row.id,
        mention_picks: row.mention_picks,
        attachments: row.attachments,
        reply_to_id: await this.quoteStillThere(row.reply_to_id),
        thread_root_id: row.thread_root_id,
        // A plain message: no card kind is module-gated, so the chapter's
        // module toggles cannot refuse it.
        enabled_modules: null,
      }));
    } catch (error) {
      const reason = refusalReason(error);
      if (reason) {
        await this.fail(row, reason);
        return { outcome: 'failed', reason, cause: error };
      }
      if (row.attempts >= SCHEDULE_MAX_ATTEMPTS) {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'chat-scheduled-message-give-up',
          message: `scheduled message ${row.id} failed ${row.attempts} sends; giving up`,
          error,
        });
        await this.fail(row, 'send_failed');
        return { outcome: 'failed', reason: 'send_failed', cause: error };
      }
      return { outcome: 'retry', cause: error };
    }
    // Posted. If this delete fails the next try finds the message by its
    // client_message_id and posts nothing new.
    await this.repo.removeSent(row);
    return { outcome: 'sent', message };
  }

  private async fail(
    row: ChatScheduledMessage,
    reason: ChatScheduledMessageFailure,
  ): Promise<void> {
    await this.repo.markFailed(row, reason);
    try {
      // The channel is named only where the author can still see it: losing
      // access may mean losing sight of it, and of a rename since.
      const channel =
        reason === 'no_access'
          ? null
          : await this.channelRepo.findById(row.channel_id, row.chapter_id);
      const where =
        channel && !isDirectChannel({ type: channel.type })
          ? `#${channel.name}`
          : 'a conversation';
      await this.notifications.notifyUser(row.user_id, row.chapter_id, {
        title: 'Scheduled message not sent',
        body:
          reason === 'no_access'
            ? "Your scheduled message didn't send: you can no longer post where it was going."
            : reason === 'chapter_locked'
              ? `Your message to ${where} didn't send: the chapter is read-only right now.`
              : `Your message to ${where} didn't send. Open it to edit or delete it.`,
        priority: 'NORMAL',
        category: 'chat',
        data: { target: { screen: 'chat', channelId: row.channel_id } },
      });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-scheduled-message-failed-notify',
        message: `Could not tell ${row.user_id} that scheduled message ${row.id} did not send`,
        error,
      });
    }
  }

  /**
   * The quote, while the quoted message still exists. One removed since it
   * was scheduled (an imported archive purged) costs the message only its
   * quote: the text was the point, and failing it would hold back a message
   * the author wrote to go out at a time. A message deleted by its author is
   * a tombstone that still exists, and is quoted as a live reply quotes it.
   */
  private async quoteStillThere(
    replyToId: string | null,
  ): Promise<string | null> {
    if (!replyToId) return null;
    return (await this.messageRepo.findById(replyToId)) ? replyToId : null;
  }

  /** The message an earlier send of this row posted, if one did. */
  private alreadyPosted(
    row: ChatScheduledMessage,
  ): Promise<ChatMessage | null> {
    return row.attempts > 0
      ? this.messageRepo.findByClientMessageId(
          row.channel_id,
          row.user_id,
          row.id,
        )
      : Promise.resolve(null);
  }

  private async requireOwn(
    chapterId: string,
    userId: string,
    id: string,
  ): Promise<ChatScheduledMessage> {
    const row = await this.repo.findForAuthor(chapterId, userId, id);
    if (!row) throw new NotFoundException('Scheduled message not found');
    return row;
  }
}

/** The text, which may be empty only when files go with it. */
function cleanContent(raw: string, hasFiles: boolean): string {
  const content = withoutObjectReplacement(raw);
  if (!content.trim() && !hasFiles) {
    throw new BadRequestException('A scheduled message needs text');
  }
  return content;
}

/** A date-time that names its offset: `Z`, or `+hh:mm` / `-hhmm`. */
const HAS_OFFSET = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i;

function checkSendAt(raw: string, now: number): string {
  // Without an offset the time would be read on the server's clock, not the
  // member's, and post hours off with no error.
  if (!HAS_OFFSET.test(raw)) {
    throw new BadRequestException(
      'send_at must be a date and time with a time zone offset',
    );
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) throw new BadRequestException('send_at is not a time');
  if (at < now - SCHEDULE_PAST_GRACE_MS) {
    throw new BadRequestException('Pick a time in the future');
  }
  if (at > now + SCHEDULE_MAX_AHEAD_MS) {
    throw new BadRequestException(
      'A message can be scheduled at most 120 days ahead',
    );
  }
  return new Date(at).toISOString();
}

/**
 * A send the server refused for the message or its author, which trying again
 * won't change. A 403 is the author's access; any other 4xx is the message.
 */
function refusalReason(error: unknown): ChatScheduledMessageFailure | null {
  if (error instanceof ForbiddenException) return 'no_access';
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return 'no_access';
    if (status >= 400 && status < 500 && status !== 429) return 'not_sendable';
  }
  return null;
}
