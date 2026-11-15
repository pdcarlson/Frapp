import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CHAT_MESSAGE_REMINDER_REPOSITORY } from '#domain/repositories/chat-message-reminder.repository.interface';
import type {
  ChatMessageReminder,
  IChatMessageReminderRepository,
} from '#domain/repositories/chat-message-reminder.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { ChannelType } from '#domain/entities/chat.entity';
import type { ChatReads } from './activity-link.service';
import { ChannelAccessService } from './channel-access.service';
import { maskBlockedBookmarkMessage } from './chat-block-mask';
import { chatPushPreview } from './chat-push-preview';
import { displayNamesById } from './display-names';

/** How far ahead a reminder may be set. */
export const REMINDER_MAX_AHEAD_DAYS = 365;
/**
 * Rows the Reminders section carries of each kind: up to 50 due, newest
 * first, then up to 50 still waiting, soonest first.
 */
export const REMINDER_LIST_LIMIT = 50;
/**
 * How far in the past a new time may be and still count as "now": a client's
 * clock running a little fast, or a preset picked as the minute turns, sets a
 * reminder the next sweep sends rather than an error.
 */
const REMINDER_PAST_GRACE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a reminder's row says once its channel is no longer readable. */
export const REMINDER_UNAVAILABLE_PREVIEW =
  '[unavailable — you no longer have access to this channel]';

/** The caller's reminder after setting it. */
export type ChatMessageReminderRef = Pick<
  ChatMessageReminder,
  'id' | 'message_id' | 'remind_at' | 'fired_at'
>;

/** A reminder on the caller's Activity page (#4957). */
export interface ActivityReminder {
  id: string;
  message_id: string;
  /** Set when the message is a thread reply: opening the row opens the thread. */
  thread_root_id: string | null;
  channel_id: string;
  /** Null when the channel is no longer readable. A DM's is server-made: use `channel_type`. */
  channel_name: string | null;
  channel_type: ChannelType | null;
  /** Empty when the author can't be named (unresolved, blocked, or no access). */
  author_name: string;
  /** What the message says, as a push would quote it. */
  preview: string;
  message_created_at: string;
  /** False when the caller can no longer read the channel: the row can only be cleared. */
  message_available: boolean;
  remind_at: string;
  /** When the push went out; null while the reminder is still waiting. */
  fired_at: string | null;
  /** Whether the time has come: what puts the row under "Needs you". */
  due: boolean;
}

/**
 * "Remind me about this" on a chat message (#4957,
 * `spec/behavior/chat/README.md` § Reminders (personal)).
 *
 * Shaped like {@link ChatBookmarkService}, and private on the same three legs:
 * no route takes a user id, every query filters on the caller, and the table
 * has RLS on with no policies. A reminder is not a bookmark with a due time
 * (the decision is the migration's header): un-Save must never cancel one.
 */
@Injectable()
export class ChatReminderService {
  constructor(
    @Inject(CHAT_MESSAGE_REMINDER_REPOSITORY)
    private readonly reminderRepo: IChatMessageReminderRepository,
    private readonly channelAccess: ChannelAccessService,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  /**
   * Sets the caller's reminder on a message they can read, or moves the one
   * there is (Activity's snooze is this same call). Authorized at `'read'`,
   * as a bookmark is: a note to self is not channel content, so it is right
   * in a channel the member can read but not post to.
   */
  async setReminder(
    messageId: string,
    chapterId: string,
    userId: string,
    remindAt: Date,
    now: Date = new Date(),
  ): Promise<ChatMessageReminderRef> {
    const at = remindAt.getTime();
    if (Number.isNaN(at)) {
      throw new BadRequestException('remind_at must be a date and time');
    }
    if (at < now.getTime() - REMINDER_PAST_GRACE_MS) {
      throw new BadRequestException('remind_at must not be in the past');
    }
    if (at > now.getTime() + REMINDER_MAX_AHEAD_DAYS * DAY_MS) {
      throw new BadRequestException(
        `remind_at must be within ${REMINDER_MAX_AHEAD_DAYS} days`,
      );
    }
    await this.channelAccess.assertMessageAccess(messageId, chapterId, userId);
    const row = await this.reminderRepo.upsert(
      userId,
      messageId,
      chapterId,
      remindAt.toISOString(),
    );
    return {
      id: row.id,
      message_id: row.message_id,
      remind_at: row.remind_at,
      fired_at: row.fired_at,
    };
  }

  /**
   * Clears the caller's reminder: Done on Activity, or cancel. Like
   * unbookmarking, it does not authorize the message, so a member who lost
   * the channel can still clear their own row, and every outcome is the same
   * 204 whether there was a reminder or not.
   */
  async clearReminder(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    await this.reminderRepo.delete(userId, messageId, chapterId);
  }

  /**
   * The caller's reminders for Activity: due ones newest first, then waiting
   * ones soonest first (see {@link REMINDER_LIST_LIMIT}). Channel access and
   * the block list are applied on every read, as for bookmarks, because the
   * embed reads the message as it is now: a channel the member lost redacts
   * the row (it stays, so they can clear it), and a blocked author's message
   * reads as the timeline's tombstone. A channel left out of Activity still
   * lists: the member asked for this one.
   */
  async listFor(
    chapterId: string,
    userId: string,
    now: number,
    { channels, blockedUserIds }: ChatReads,
  ): Promise<ActivityReminder[]> {
    const rows = await this.reminderRepo.findByUserAndChapter(
      userId,
      chapterId,
      new Date(now).toISOString(),
      REMINDER_LIST_LIMIT,
    );
    if (rows.length === 0) return [];
    const readable = new Map(channels.map((channel) => [channel.id, channel]));
    const blocked = new Set(blockedUserIds);
    const names = await displayNamesById(
      this.userRepo,
      rows.flatMap((row) =>
        row.message.sender_id && readable.has(row.message.channel_id)
          ? [row.message.sender_id]
          : [],
      ),
    );
    return rows.map((row) => {
      const channel = readable.get(row.message.channel_id);
      const shared = {
        id: row.id,
        message_id: row.message_id,
        channel_id: row.message.channel_id,
        message_created_at: row.message.created_at,
        remind_at: row.remind_at,
        fired_at: row.fired_at,
        due: new Date(row.remind_at).getTime() <= now,
      };
      if (!channel) {
        return {
          ...shared,
          thread_root_id: null,
          channel_name: null,
          channel_type: null,
          author_name: '',
          preview: REMINDER_UNAVAILABLE_PREVIEW,
          message_available: false,
        };
      }
      const message = maskBlockedBookmarkMessage(row.message, blocked);
      return {
        ...shared,
        thread_root_id: message.thread_root_id ?? null,
        channel_name: channel.name,
        channel_type: channel.type,
        author_name: message.sender_blocked
          ? ''
          : (message.author_name ??
            (message.sender_id ? (names.get(message.sender_id) ?? '') : '')),
        preview: message.is_deleted
          ? message.content
          : chatPushPreview(message),
        message_available: true,
      };
    });
  }
}
