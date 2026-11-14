import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { CHAT_MESSAGE_REMINDER_REPOSITORY } from '#domain/repositories/chat-message-reminder.repository.interface';
import type {
  IChatMessageReminderRepository,
  StoredChatMessageReminder,
} from '#domain/repositories/chat-message-reminder.repository.interface';
import type { ChatChannel } from '#domain/entities/chat.entity';
import { ChannelAccessService } from '../services/channel-access.service';
import { ChatBlockService } from '../services/chat-block.service';
import { maskBlockedBookmarkMessage } from '../services/chat-block-mask';
import { chatPushPreview } from '../services/chat-push-preview';
import { NotificationService } from '../services/notification.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Due reminders one tick reads; the rest wait a minute. */
export const REMINDER_SWEEP_BATCH = 50;

/**
 * The category a reminder push is sent under. Not one of the member's
 * notification switches (`isNotificationCategoryKey`), so no switch silences
 * it, as Slack's reminders aren't: the member asked for this one. Quiet hours
 * still hold it to a silent push.
 */
export const REMINDER_NOTIFICATION_CATEGORY = 'reminder';

/**
 * Sends each reminder's push when its time comes (#4957,
 * `spec/behavior/chat/README.md` § Reminders (personal)).
 *
 * Every replica runs this cron, so each row is claimed with a compare-and-set
 * before its push (as `LinkTitleSweepService` claims a link): only the
 * replica whose update matched sends. The claim also names the time it read,
 * so a reminder the member moved in the meantime waits for its new time.
 *
 * A claimed row is fired whether or not a push goes out, and stays on the
 * member's Activity page until they clear it. No push is sent for a message
 * in a channel the member can no longer read, and a blocked author's message
 * is not quoted.
 */
@Injectable()
export class ChatReminderSweepService {
  private readonly logger = new Logger(ChatReminderSweepService.name);
  /** One tick at a time on this replica; a slow tick skips the next. */
  private running = false;

  constructor(
    @Inject(CHAT_MESSAGE_REMINDER_REPOSITORY)
    private readonly reminderRepo: IChatMessageReminderRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatBlocks: ChatBlockService,
    private readonly notificationService: NotificationService,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleReminderSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(Date.now());
    } finally {
      this.running = false;
    }
  }

  async sweep(now: number): Promise<{ fired: number; pushed: number }> {
    const at = new Date(now).toISOString();
    const due = await this.reminderRepo.findDue(at, REMINDER_SWEEP_BATCH);
    const tally = { fired: 0, pushed: 0 };
    for (const reminder of due) {
      if (!(await this.reminderRepo.claimDue(reminder, at))) continue;
      tally.fired += 1;
      try {
        if (await this.deliver(reminder)) tally.pushed += 1;
      } catch (error) {
        // Fired without a push: the row still waits on Activity.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'chat-reminder-push',
          message: `reminder ${reminder.id} fired but its notification failed`,
          error,
        });
      }
    }
    return tally;
  }

  /** Sends the reminder's notification; false when there was none to send. */
  private async deliver(reminder: StoredChatMessageReminder): Promise<boolean> {
    const channel = await this.readableChannel(reminder);
    if (!channel) return false;
    const blocked = new Set(
      await this.chatBlocks.listBlockedUserIds(
        reminder.chapter_id,
        reminder.user_id,
      ),
    );
    const message = maskBlockedBookmarkMessage(reminder.message, blocked);
    const body = message.is_deleted
      ? 'The message you asked about was deleted'
      : message.sender_blocked
        ? 'You asked to be reminded about a message'
        : chatPushPreview(message);
    const threadRootId = message.thread_root_id ?? null;
    await this.notificationService.notifyUser(
      reminder.user_id,
      reminder.chapter_id,
      {
        title: 'Reminder',
        body,
        category: REMINDER_NOTIFICATION_CATEGORY,
        data: {
          target: threadRootId
            ? { screen: 'chat', channelId: channel.id, threadRootId }
            : { screen: 'chat', channelId: channel.id },
          reminder: true,
        },
        // Ties the in-app row to the message (a delete removes it) and sends
        // `messageId` in the push, which opens the chat at this message.
        chatMessageId: message.id,
      },
    );
    return true;
  }

  private async readableChannel(
    reminder: StoredChatMessageReminder,
  ): Promise<ChatChannel | null> {
    try {
      return await this.channelAccess.assertChannelAccess(
        reminder.message.channel_id,
        reminder.chapter_id,
        reminder.user_id,
        'read',
      );
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        return null;
      }
      throw error;
    }
  }
}
