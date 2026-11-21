import type { Logger } from '@nestjs/common';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import type {
  NotificationService,
  NotifyPayload,
} from './notification.service';

/**
 * The push helpers TaskService and OpenTaskService share: a member's name for
 * a push line, and a push nobody retries.
 */

/** A member's display name for a push, or null when it cannot be read. */
export async function displayNameFor(
  userRepo: IUserRepository,
  userId: string,
): Promise<string | null> {
  try {
    const [user] = await userRepo.findByIds([userId]);
    const name = user?.display_name?.trim();
    return name ? name : null;
  } catch {
    return null;
  }
}

/**
 * Send one push; a failure is reported, not thrown (#4096), so a failing
 * notifications write is never silent and never fails the change it follows.
 */
export async function notifyQuietly(
  notificationService: NotificationService,
  logger: Logger,
  push: {
    userId: string;
    chapterId: string;
    payload: NotifyPayload;
    site: string;
    /** What the push is about, for the report: "task <id> (update)". */
    about: string;
  },
): Promise<void> {
  try {
    await notificationService.notifyUser(
      push.userId,
      push.chapterId,
      push.payload,
    );
  } catch (error) {
    reportCaughtFailure(logger, {
      level: 'warning',
      site: push.site,
      message: `notifyUser failed for ${push.about} / user ${push.userId}`,
      error,
    });
  }
}
