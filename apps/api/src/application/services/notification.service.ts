import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { NOTIFICATION_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { INotificationRepository } from '../../domain/repositories/notification.repository.interface';
import { PUSH_TOKEN_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { IPushTokenRepository } from '../../domain/repositories/notification.repository.interface';
import { NOTIFICATION_PREFERENCE_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { INotificationPreferenceRepository } from '../../domain/repositories/notification.repository.interface';
import { USER_SETTINGS_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import type { IUserSettingsRepository } from '../../domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';
import type { INotificationProvider } from '../../domain/adapters/notification.interface';
import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '../../domain/entities/notification.entity';

/** Cap on how much of an offending value reaches a log line. */
const LOGGED_VALUE_MAX_LENGTH = 64;

/**
 * Render an untrusted stored value for a log message.
 *
 * The values this guards are legacy `quiet_hours_tz` rows written when the
 * column enforced only `@IsString()` — so one can carry newlines, ANSI escapes,
 * or enough length to bury the surrounding context. Forging a convincing extra
 * log entry from inside a quoted field is the concrete risk; `JSON.stringify`
 * escapes the control characters that would end the line, and the cap bounds
 * the rest.
 */
function summarizeForLog(value: string): string {
  const clipped =
    value.length > LOGGED_VALUE_MAX_LENGTH
      ? `${value.slice(0, LOGGED_VALUE_MAX_LENGTH)}…`
      : value;
  return JSON.stringify(clipped);
}

export type NotifyPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'URGENT' | 'NORMAL' | 'SILENT';
  category?: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  /**
   * `user:zone` pairs already reported by `resolveQuietHoursFormatter`. Bounded
   * by the number of members holding an unusable stored zone, which the DTO
   * validation now stops growing.
   */
  private readonly warnedQuietHoursZones = new Set<string>();

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepo: INotificationRepository,
    @Inject(PUSH_TOKEN_REPOSITORY)
    private readonly pushTokenRepo: IPushTokenRepository,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly preferenceRepo: INotificationPreferenceRepository,
    @Inject(USER_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IUserSettingsRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly pushProvider: INotificationProvider,
  ) {}

  async notifyUser(
    userId: string,
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<void> {
    const category = payload.category ?? 'default';
    const priority = payload.priority ?? 'NORMAL';

    // URGENT outranks the member's category preference — for the in-app row
    // below as well as the push. A member must not be able to mute a chapter
    // emergency from a settings screen: `announcements` and the president's
    // subscription-status alert are URGENT precisely because they are not
    // optional. Suppressing the row would be the same failure in a slower
    // form, leaving no trace of the broadcast anywhere. Quiet hours already
    // exempt URGENT immediately below; this gate was the outlier.
    //
    // The lookup is gated rather than reordered so neither path pays for the
    // other: URGENT skips the preference read entirely, and a suppressed
    // category still returns before the `user_settings` read.
    if (priority !== 'URGENT') {
      const pref = await this.preferenceRepo.findByUserChapterCategory(
        userId,
        chapterId,
        category,
      );
      if (pref && !pref.is_enabled) {
        return;
      }
    }

    const settings = await this.settingsRepo.findByUser(userId);
    let effectivePriority = priority;
    if (
      effectivePriority !== 'URGENT' &&
      this.isInQuietHours(settings, userId)
    ) {
      effectivePriority = 'SILENT';
    }

    const notification = await this.notificationRepo.create({
      chapter_id: chapterId,
      user_id: userId,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });

    // Push is best-effort, and the token lookup is part of it. Once the
    // notification row above is committed the user *has* been notified in
    // app, so nothing after this point may throw out of `notifyUser` — a
    // caller that retried on a token-lookup blip would write a second
    // notification row for the same event. That matters for the scheduled
    // reminder sweeps, which release their dispatch claim and retry when a
    // delivery reports failure.
    try {
      const pushTokens = await this.pushTokenRepo.findByUser(userId);
      if (pushTokens.length === 0) return;

      const { invalidTokens } = await this.pushProvider.sendToUser(
        pushTokens.map((t) => t.token),
        {
          title: payload.title,
          body: payload.body,
          data: { ...payload.data, notificationId: notification.id },
          priority: effectivePriority,
          // Forwarded for delivery telemetry only — lets `push_delivery`
          // records be sliced by category (see the Expo provider).
          category,
        },
      );

      // Pruning stays in the application layer — the provider only classifies
      // Expo's response, it never touches `push_tokens` itself. Best-effort
      // and outside the outer catch's concern: a delete failure here must
      // never read as "push delivery failed" in the log line below.
      await Promise.allSettled(
        invalidTokens.map((token) =>
          this.pushTokenRepo.deleteByToken(token).catch((err) => {
            this.logger.warn(`Failed to prune invalid push token`, err);
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`Push delivery failed for user ${userId}`, err);
    }
  }

  async notifyChapter(
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<void> {
    const members = await this.memberRepo.findByChapter(chapterId);
    await Promise.allSettled(
      members.map((member) =>
        this.notifyUser(member.user_id, chapterId, payload),
      ),
    );
  }

  private isInQuietHours(
    settings: UserSettings | null,
    userId: string,
  ): boolean {
    if (!settings?.quiet_hours_start || !settings?.quiet_hours_end) {
      return false;
    }

    // `||`, not `??`: a blank stored zone means "unset", not "invalid". Rows
    // written before the field was validated can hold `''`, and `??` would send
    // that through the formatter to throw and warn on every single delivery.
    const tz = settings.quiet_hours_tz || 'UTC';
    const now = new Date();
    const formatter = this.resolveQuietHoursFormatter(tz, userId);
    if (!formatter) {
      return false;
    }
    const parts = formatter.formatToParts(now);
    const hour =
      parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
    const minute = parseInt(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
      10,
    );
    const currentMinutes = hour * 60 + minute;

    const [startH, startM] = settings.quiet_hours_start
      .split(':')
      .map((s) => parseInt(s, 10));
    const [endH, endM] = settings.quiet_hours_end
      .split(':')
      .map((s) => parseInt(s, 10));
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * `Intl.DateTimeFormat` throws `RangeError` on an unknown IANA zone, and this
   * runs *before* `notificationRepo.create` — so an uncaught throw costs the
   * member the push **and** the in-app row, silently, since `notifyChapter`
   * swallows the rejection through `Promise.allSettled`. Rows predating the
   * `quiet_hours_tz` DTO validation can still carry such a zone, so degrade
   * instead of throwing: a time-shifted quiet window is a far smaller failure
   * than a member whose notifications simply stop.
   *
   * Returns `null` only when the runtime cannot resolve `UTC` either — an ICU
   * build that can't do zones at all. Quiet hours are then skipped rather than
   * costing the member the notification, keeping this method total.
   *
   * The warning is emitted after the fallback resolves, once per (user, zone)
   * per process — see the comments inline.
   */
  private resolveQuietHoursFormatter(
    tz: string,
    userId: string,
  ): Intl.DateTimeFormat | null {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };

    try {
      return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: tz });
    } catch {
      // Fall through — the zone is unusable; report it once we know what we
      // actually fell back to, so the log never claims a UTC fallback that
      // itself failed.
    }

    let fallback: Intl.DateTimeFormat | null = null;
    try {
      fallback = new Intl.DateTimeFormat('en-CA', {
        ...options,
        timeZone: 'UTC',
      });
    } catch {
      fallback = null;
    }

    // The offending row cannot repair itself, and this runs per delivery — for a
    // chapter-wide send that is one line per affected member, every time. Warn
    // once per (user, zone) per process so the signal survives without becoming
    // the noise that hides the next problem.
    const warnKey = `${userId}:${tz}`;
    if (!this.warnedQuietHoursZones.has(warnKey)) {
      this.warnedQuietHoursZones.add(warnKey);
      const safeTz = summarizeForLog(tz);
      this.logger.warn(
        fallback
          ? `Invalid quiet_hours_tz ${safeTz} for user ${userId} — falling back to UTC`
          : `Invalid quiet_hours_tz ${safeTz} for user ${userId} and this runtime cannot resolve UTC — skipping quiet-hours enforcement`,
      );
    }

    return fallback;
  }

  async listNotifications(
    userId: string,
    options?: { limit?: number },
  ): Promise<Notification[]> {
    return this.notificationRepo.findByUser(userId, options);
  }

  async markNotificationRead(
    id: string,
    userId: string,
  ): Promise<Notification> {
    const existing = await this.notificationRepo.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return this.notificationRepo.markRead(id, userId);
  }

  async registerPushToken(
    userId: string,
    token: string,
    deviceName?: string,
  ): Promise<PushToken> {
    const existing = await this.pushTokenRepo.findByToken(token);
    if (existing) {
      if (existing.user_id === userId) {
        return existing;
      }
      await this.pushTokenRepo.deleteByToken(token);
    }

    return this.pushTokenRepo.create({
      user_id: userId,
      token,
      device_name: deviceName ?? null,
    });
  }

  async removePushToken(id: string, userId: string): Promise<void> {
    const existing = await this.pushTokenRepo.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException('Push token not found');
    }
    await this.pushTokenRepo.delete(id, userId);
  }

  async getPreferences(
    userId: string,
    chapterId: string,
  ): Promise<NotificationPreference[]> {
    await this.assertChapterMembership(userId, chapterId);
    return this.preferenceRepo.findByUserAndChapter(userId, chapterId);
  }

  async updatePreference(
    userId: string,
    chapterId: string,
    category: string,
    isEnabled: boolean,
  ): Promise<NotificationPreference> {
    await this.assertChapterMembership(userId, chapterId);
    return this.preferenceRepo.upsert({
      user_id: userId,
      chapter_id: chapterId,
      category,
      is_enabled: isEnabled,
    });
  }

  /**
   * Enforce the multi-tenancy invariant on chapter-scoped preference access:
   * a user may only read or write notification preferences for a chapter they
   * are an active member of. The chapter here comes from the request query/body
   * rather than the resolved active chapter, so it must be verified explicitly.
   */
  private async assertChapterMembership(
    userId: string,
    chapterId: string,
  ): Promise<void> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) {
      throw new ForbiddenException('You are not a member of this chapter');
    }
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    return this.settingsRepo.findByUser(userId);
  }

  async updateSettings(
    userId: string,
    data: Partial<
      Pick<
        UserSettings,
        'quiet_hours_start' | 'quiet_hours_end' | 'quiet_hours_tz' | 'theme'
      >
    >,
  ): Promise<UserSettings> {
    const existing = await this.settingsRepo.findByUser(userId);
    // `undefined` means "not supplied" and `null` means "clear this". Test the
    // VALUE, not key presence: `field in data` is always true here, because
    // class-transformer materializes every declared DTO property as an own key
    // (undefined when absent). Keying on presence made a theme-only PATCH read
    // as an explicit clear and wipe the member's whole quiet-hours window.
    const resolve = <K extends keyof typeof data>(field: K) =>
      data[field] !== undefined
        ? (data[field] ?? null)
        : (existing?.[field] ?? null);
    return this.settingsRepo.upsert({
      user_id: userId,
      quiet_hours_start: resolve('quiet_hours_start'),
      quiet_hours_end: resolve('quiet_hours_end'),
      quiet_hours_tz: resolve('quiet_hours_tz'),
      theme: data.theme ?? existing?.theme ?? 'system',
    });
  }
}
