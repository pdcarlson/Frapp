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
import {
  CHAT_SCHEDULED_MESSAGE_REPOSITORY,
  type ChatScheduledMessagePatch,
  type IChatScheduledMessageRepository,
} from '#domain/repositories/chat-scheduled-message.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import type {
  ChatScheduledMessage,
  ChatScheduledMessageFailure,
} from '#domain/entities/chat-scheduled-message.entity';
import type { ChatMessage } from '#domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';
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
 * Only text (with `@` picks) can be scheduled for now: no attachments, GIFs,
 * cards, replies or thread replies.
 */
@Injectable()
export class ChatScheduledMessageService {
  private readonly logger = new Logger(ChatScheduledMessageService.name);

  constructor(
    @Inject(CHAT_SCHEDULED_MESSAGE_REPOSITORY)
    private readonly repo: IChatScheduledMessageRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    private readonly channelAccess: ChannelAccessService,
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
    input: ScheduleMessageInput,
    now = Date.now(),
  ): Promise<ChatScheduledMessage> {
    const content = cleanContent(input.content);
    const sendAt = checkSendAt(input.send_at, now);
    await this.channelAccess.assertChannelAccess(
      input.channel_id,
      chapterId,
      userId,
      'post',
    );
    const pending = (await this.repo.listForAuthor(chapterId, userId)).filter(
      (row) => row.status === 'pending',
    );
    if (pending.length >= SCHEDULE_MAX_PENDING) {
      throw new BadRequestException(
        `You can have at most ${SCHEDULE_MAX_PENDING} scheduled messages at once`,
      );
    }
    return this.repo.create({
      chapter_id: chapterId,
      channel_id: input.channel_id,
      user_id: userId,
      content,
      mention_picks: input.mention_picks ?? null,
      send_at: sendAt,
    });
  }

  /**
   * Changes the text or the time. Editing a failed message puts it back in
   * line, checked against the author's access again as a new one would be.
   */
  async update(
    chapterId: string,
    userId: string,
    id: string,
    input: Partial<Omit<ScheduleMessageInput, 'channel_id'>>,
    now = Date.now(),
  ): Promise<ChatScheduledMessage> {
    const row = await this.requireOwn(chapterId, userId, id);
    const patch: ChatScheduledMessagePatch = {};
    if (input.content !== undefined) {
      patch.content = cleanContent(input.content);
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
      'post',
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

  async remove(chapterId: string, userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteForAuthor(chapterId, userId, id);
    if (!deleted) throw new NotFoundException('Scheduled message not found');
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
    const result = await this.deliver({ ...row, attempts: row.attempts + 1 });
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
      ({ message } = await this.chat.sendMessage({
        chapter_id: row.chapter_id,
        channel_id: row.channel_id,
        sender_id: row.user_id,
        content: row.content,
        client_message_id: row.id,
        mention_picks: row.mention_picks,
        // A text message: no card kind is module-gated, so the chapter's
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
      const channel = await this.channelRepo.findById(
        row.channel_id,
        row.chapter_id,
      );
      const where =
        channel && !isDirectChannel({ type: channel.type })
          ? `#${channel.name}`
          : 'that conversation';
      await this.notifications.notifyUser(row.user_id, row.chapter_id, {
        title: 'Scheduled message not sent',
        body:
          reason === 'no_access'
            ? `Your message to ${where} didn't send: you can no longer post there.`
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

function cleanContent(raw: string): string {
  const content = withoutObjectReplacement(raw);
  if (!content.trim()) {
    throw new BadRequestException('A scheduled message needs text');
  }
  return content;
}

function checkSendAt(raw: string, now: number): string {
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
