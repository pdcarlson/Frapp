import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { NOTIFICATION_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import type { INotificationRepository } from '#domain/repositories/notification.repository.interface';
import { PUSH_TOKEN_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import type { IPushTokenRepository } from '#domain/repositories/notification.repository.interface';
import { NOTIFICATION_PREFERENCE_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import type { INotificationPreferenceRepository } from '#domain/repositories/notification.repository.interface';
import { USER_SETTINGS_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import type { IUserSettingsRepository } from '#domain/repositories/notification.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { NOTIFICATION_PROVIDER } from '#domain/adapters/notification.interface';
import type { INotificationProvider } from '#domain/adapters/notification.interface';
import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
  UserSettingsValues,
} from '#domain/entities/notification.entity';
import { clampListLimit } from '#domain/constants/list-query-limits';
import { parseIsoInstant } from '#domain/constants/iso-instant';
import { ID_CHUNK_SIZE, chunkIds } from '#domain/utils/chunk-ids';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  isNotificationCategoryKey,
  isSupportedTimeZone,
} from '@repo/validation';
import { ChatBlockService } from './chat-block.service';

/**
 * What a member with no `user_settings` row has, which is every member until
 * their first save: nothing writes the row at sign-up or on joining a chapter.
 * Mirrors the table's column defaults (`00000000000000_initial_schema.sql`): no
 * quiet-hours window, so none is enforced, and the `system` theme.
 */
const USER_SETTINGS_DEFAULTS: UserSettingsValues = {
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_tz: null,
  theme: 'system',
  status: 'online',
  status_expires_at: null,
  custom_status: null,
  custom_status_expires_at: null,
};

/** True when `expiresAt` is set and is not later than `now`. */
function hasExpired(expiresAt: string | null | undefined, now: Date): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() <= now.getTime();
}

/**
 * The {@link UserSettingsValues} a stored row holds, as of `now`. A status whose
 * end time has passed reads as `online`, and an expired custom line as none
 * (#3845): the row keeps the stale values until the member next sets that status or
 * line, so
 * every read resolves them.
 */
function toUserSettingsValues(
  row: UserSettings,
  now: Date = new Date(),
): UserSettingsValues {
  const statusExpired = hasExpired(row.status_expires_at, now);
  const customExpired = hasExpired(row.custom_status_expires_at, now);
  return {
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    quiet_hours_tz: row.quiet_hours_tz,
    theme: row.theme,
    status: statusExpired ? 'online' : (row.status ?? 'online'),
    status_expires_at: statusExpired ? null : (row.status_expires_at ?? null),
    custom_status: customExpired ? null : (row.custom_status ?? null),
    custom_status_expires_at: customExpired
      ? null
      : (row.custom_status_expires_at ?? null),
  };
}

/**
 * Whether the member has Do Not Disturb on right now (#3845). DND is quiet
 * hours switched on now: non-URGENT pushes arrive SILENT, URGENT still rings
 * (`spec/behavior/notifications.md` § Do Not Disturb).
 */
function isDoNotDisturb(settings: UserSettings | null, now: Date): boolean {
  return (
    settings?.status === 'dnd' && !hasExpired(settings.status_expires_at, now)
  );
}

/**
 * Rejects an end time that is not a future instant. A past one would save a
 * status that is already over, which the member would read as their pick being
 * ignored.
 */
function assertFutureExpiry(
  field: string,
  value: string | null,
  now: Date,
): void {
  if (value === null) return;
  // `parseIsoInstant`, not `new Date`: it refuses an impossible day rather
  // than rolling it forward to one Postgres would then reject as a 500.
  const at = parseIsoInstant(value);
  if (at === null || at <= now.getTime()) {
    throw new BadRequestException(`${field} must be a time in the future`);
  }
}

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

/**
 * Who a notification is being written for, as far as its wording needs to know:
 * the recipient and the zone their clock reads in. `timeZone` is null when the
 * member has never reported one (see {@link recipientTimeZone}).
 */
export type NotifyRecipient = {
  userId: string;
  timeZone: string | null;
};

export type NotifyPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'URGENT' | 'NORMAL' | 'SILENT';
  category?: string;
  /** The push's iOS stack (`PushPayload.threadId`). Not stored on the in-app row. */
  threadId?: string;
  /**
   * Per-recipient wording. When set, it replaces `title` and `body` for each
   * recipient, in both the in-app row and the push, so a push can name a time
   * in the recipient's own zone or say whether an event is required for *them*
   * (`spec/behavior/notifications.md` § What a push says). `title` and `body`
   * stay the fallback for a caller that cannot personalize.
   */
  personalize?: (recipient: NotifyRecipient) => { title: string; body: string };
};

/**
 * The zone a member's clock reads in: the one their app last reported
 * (`user_settings.time_zone`, sent on every request as `x-time-zone`), else the
 * zone their quiet hours run in, else null. A stored value this runtime cannot
 * resolve counts as none, so formatting never throws on a legacy row.
 */
export function recipientTimeZone(
  settings:
    | (Pick<UserSettings, 'quiet_hours_tz'> & { time_zone?: string | null })
    | null,
): string | null {
  if (!settings) return null;
  if (isSupportedTimeZone(settings.time_zone)) return settings.time_zone;
  if (isSupportedTimeZone(settings.quiet_hours_tz))
    return settings.quiet_hours_tz;
  return null;
}

/** The payload as one recipient reads it: `personalize` applied, then dropped. */
function payloadFor(
  payload: NotifyPayload,
  userId: string,
  settings: UserSettings | null,
): NotifyPayload {
  const { personalize, ...rest } = payload;
  if (!personalize) return rest;
  return {
    ...rest,
    ...personalize({ userId, timeZone: recipientTimeZone(settings) }),
  };
}

/**
 * Whether the in-app list withholds this row from a caller with `blocked`: a
 * chat row from one of them, or a chat row that records no sender while they
 * have blocked anyone (#2715). The list applies the same rule in its query
 * (`notChatFrom` in the Supabase notification repository); this is the rule for
 * a row already in hand.
 */
function isWithheldChatRow(
  row: Pick<Notification, 'data'>,
  blocked: readonly string[],
): boolean {
  if (blocked.length === 0) return false;
  const target = row.data?.target;
  const screen =
    target !== null && typeof target === 'object'
      ? (target as Record<string, unknown>).screen
      : undefined;
  if (screen !== 'chat') return false;
  const senderId = row.data?.senderId;
  return typeof senderId !== 'string' || blocked.includes(senderId);
}

/** In-app insert shape shared by `notifyUser` and the batched chapter path. */
function inAppRow(
  userId: string,
  chapterId: string,
  payload: NotifyPayload,
): Pick<Notification, 'chapter_id' | 'user_id' | 'title' | 'body' | 'data'> {
  return {
    chapter_id: chapterId,
    user_id: userId,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  };
}

/**
 * Whether a member's category preference can stop this payload: never for
 * URGENT (#1041), and only for a category the member has a switch for
 * (`NOTIFICATION_CATEGORIES`). A row for any other key has no control left to
 * undo it. `chat` is the case that matters: its switch was dropped
 * (2026-11-06) in favour of per-channel and per-DM levels, and a `chat` row an
 * older build wrote must not keep a member muted with nothing to turn it back
 * on (`spec/behavior/notifications.md` § Preference sync).
 */
function isMemberSwitchable(category: string, priority: string): boolean {
  return priority !== 'URGENT' && isNotificationCategoryKey(category);
}

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
    /** The caller's block list, which the in-app list masks chat rows by (#2715). */
    private readonly chatBlocks: ChatBlockService,
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
    if (isMemberSwitchable(category, priority)) {
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
    if (effectivePriority !== 'URGENT' && this.isQuieted(settings, userId)) {
      effectivePriority = 'SILENT';
    }

    payload = payloadFor(payload, userId, settings);

    const notification = await this.notificationRepo.create(
      inAppRow(userId, chapterId, payload),
    );

    // Push is best-effort, and the token lookup is part of it. Once the
    // notification row above is committed the user *has* been notified in
    // app, so nothing after this point may throw out of `notifyUser` — a
    // caller that retried on a token-lookup blip would write a second
    // notification row for the same event. That matters for the scheduled
    // reminder sweeps, which release their dispatch claim and retry when a
    // delivery reports failure.
    try {
      const pushTokens = await this.pushTokenRepo.findByUser(userId);
      await this.sendPushAndPrune(
        pushTokens,
        notification.id,
        payload,
        effectivePriority,
        category,
      );
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `Push delivery failed for user ${userId}`,
        err,
      );
    }
  }

  /**
   * The zone `userId`'s clock reads in (see {@link recipientTimeZone}), or null
   * when they have none or the read fails. For a sender whose zone stands in
   * for a recipient who has never reported one: chapter members share a
   * campus, so the person who scheduled an event is the best guess for it.
   */
  async timeZoneFor(userId: string): Promise<string | null> {
    try {
      return recipientTimeZone(await this.settingsRepo.findByUser(userId));
    } catch {
      return null;
    }
  }

  /**
   * Notify every member of a chapter.
   *
   * There is no audience filter. Its one caller, `ChatService`'s announcement
   * fan-out, dropped blockers through one; that path was deleted when the chat
   * push worker became the only chat push path (#2771), and the worker applies
   * `ChatBlockService.filterOutBlockers` itself. A caller whose audience
   * depends on a block, or on anything else this service does not own, belongs
   * on a per-recipient `notifyUser` loop, not here.
   */
  async notifyChapter(
    chapterId: string,
    payload: NotifyPayload,
  ): Promise<void> {
    const members = await this.memberRepo.findByChapter(chapterId);
    await this.notifyMembers(
      chapterId,
      members.map((member) => member.user_id),
      payload,
    );
  }

  /**
   * Notify a chosen set of a chapter's members, with the batched reads
   * `notifyChapter` uses (a few chunked queries, not ~4 per member). For a
   * caller that picks its own audience, such as an event announcement that
   * leaves out its creator and members its roles do not invite. The caller owns
   * that the ids are members of `chapterId`.
   */
  async notifyMembers(
    chapterId: string,
    memberUserIds: readonly string[],
    payload: NotifyPayload,
  ): Promise<void> {
    const userIds = [...new Set(memberUserIds)];
    if (userIds.length === 0) return;

    const category = payload.category ?? 'default';
    const priority = payload.priority ?? 'NORMAL';

    let eligible = userIds;
    if (isMemberSwitchable(category, priority)) {
      const { rows: prefs, failedIds } = await this.loadInChunks(
        userIds,
        (chunk) =>
          this.preferenceRepo.findByUsersChapterCategory(
            chunk,
            chapterId,
            category,
          ),
        'preference lookup',
        chapterId,
      );
      const skipped = new Set(failedIds);
      const disabled = new Set(
        prefs.filter((pref) => !pref.is_enabled).map((pref) => pref.user_id),
      );
      eligible = userIds.filter((id) => !disabled.has(id) && !skipped.has(id));
      if (eligible.length === 0) return;
    }

    // URGENT ignores quiet hours, so the settings read is only for NORMAL /
    // SILENT payloads, or for a personalized one that needs each recipient's
    // zone. `notifyUser` still reads settings for URGENT and then skips the
    // window — this path just does not pay for that lookup.
    let settingsByUser = new Map<string, UserSettings>();
    if (priority !== 'URGENT' || payload.personalize) {
      const { rows: settingsRows, failedIds } = await this.loadInChunks(
        eligible,
        (chunk) => this.settingsRepo.findByUserIds(chunk),
        'settings lookup',
        chapterId,
      );
      const skipped = new Set(failedIds);
      eligible = eligible.filter((id) => !skipped.has(id));
      if (eligible.length === 0) return;
      settingsByUser = new Map(settingsRows.map((row) => [row.user_id, row]));
    }

    const recipients: {
      userId: string;
      effectivePriority: NotifyPayload['priority'];
    }[] = eligible.map((userId) => {
      let effectivePriority = priority;
      if (
        effectivePriority !== 'URGENT' &&
        this.isQuieted(settingsByUser.get(userId) ?? null, userId)
      ) {
        effectivePriority = 'SILENT';
      }
      return { userId, effectivePriority };
    });

    const payloadByUser = new Map(
      recipients.map(({ userId }) => [
        userId,
        payloadFor(payload, userId, settingsByUser.get(userId) ?? null),
      ]),
    );

    const created: Notification[] = [];
    let insertFailures = 0;
    const recipientChunks: (typeof recipients)[] = [];
    for (let i = 0; i < recipients.length; i += ID_CHUNK_SIZE) {
      recipientChunks.push(recipients.slice(i, i + ID_CHUNK_SIZE));
    }
    const insertResults = await Promise.allSettled(
      recipientChunks.map((chunk) =>
        this.notificationRepo.createMany(
          chunk.map(({ userId }) =>
            inAppRow(userId, chapterId, payloadByUser.get(userId) ?? payload),
          ),
        ),
      ),
    );
    for (let i = 0; i < insertResults.length; i++) {
      const result = insertResults[i];
      const chunk = recipientChunks[i];
      if (result.status === 'fulfilled') {
        created.push(...result.value);
      } else {
        insertFailures += chunk.length;
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'chapter-notify-insert-failed',
          message: `Chapter notify insert failed for ${chunk.length} recipients in ${chapterId}`,
          error: result.reason,
        });
      }
    }

    if (insertFailures > 0) {
      this.logger.warn(
        `Chapter notify insert failed for ${insertFailures} of ${recipients.length} recipients in ${chapterId}`,
      );
    }

    if (created.length === 0) return;

    const createdUserIds = [
      ...new Set(created.map((notification) => notification.user_id)),
    ];
    const { rows: tokens } = await this.loadInChunks(
      createdUserIds,
      (chunk) => this.pushTokenRepo.findByUserIds(chunk),
      'token lookup',
      chapterId,
    );

    const tokensByUser = new Map<string, PushToken[]>();
    for (const token of tokens) {
      const list = tokensByUser.get(token.user_id);
      if (list) list.push(token);
      else tokensByUser.set(token.user_id, [token]);
    }

    const priorityByUser = new Map(
      recipients.map((recipient) => [
        recipient.userId,
        recipient.effectivePriority,
      ]),
    );

    const pushResults = await Promise.allSettled(
      created.map(async (notification) => {
        const userTokens = tokensByUser.get(notification.user_id) ?? [];
        await this.sendPushAndPrune(
          userTokens,
          notification.id,
          payloadByUser.get(notification.user_id) ?? payload,
          priorityByUser.get(notification.user_id) ?? 'NORMAL',
          category,
        );
      }),
    );

    const pushFailures = pushResults.filter(
      (result) => result.status === 'rejected',
    ).length;
    if (pushFailures > 0) {
      this.logger.warn(
        `Chapter notify push failed for ${pushFailures} of ${created.length} recipients in ${chapterId}`,
      );
    }
  }

  /**
   * Expo send plus invalid-token prune. Shared by `notifyUser` and the
   * chapter-wide path so the payload shape (including `notificationId`) cannot
   * drift. Callers own the "push is best-effort" boundary: `notifyUser`
   * catches, `notifyChapter` counts rejections.
   *
   * Pruning stays in the application layer — the provider only classifies
   * Expo's response, it never touches `push_tokens` itself. Best-effort:
   * a delete failure must never read as "push delivery failed". Each
   * deletion catches its own rejection, so nothing here can actually reject
   * — `Promise.all` (not `allSettled`) says that plainly.
   */
  private async sendPushAndPrune(
    tokens: PushToken[],
    notificationId: string,
    payload: NotifyPayload,
    priority: NotifyPayload['priority'],
    category: string,
  ): Promise<void> {
    if (tokens.length === 0) return;

    const { invalidTokens } = await this.pushProvider.sendToUser(
      tokens.map((token) => token.token),
      {
        title: payload.title,
        body: payload.body,
        data: { ...payload.data, notificationId },
        priority,
        // Forwarded for delivery telemetry only — lets `push_delivery`
        // records be sliced by category (see the Expo provider).
        category,
        threadId: payload.threadId,
      },
    );

    await Promise.all(
      invalidTokens.map((token) =>
        this.pushTokenRepo.deleteByToken(token).catch((err) => {
          logThrowable(
            this.logger,
            'warn',
            'Failed to prune invalid push token',
            err,
          );
        }),
      ),
    );
  }

  /**
   * One chunked `in (...)` lookup that isolates a failed 100-id page so the
   * rest of a chapter-wide send still runs. A rejection used to be per member
   * (and `notifyChapter` swallowed it); failing the whole roster because one
   * page 414'd or timed out would be a step backwards.
   */
  private async loadInChunks<T>(
    ids: string[],
    load: (chunk: string[]) => Promise<T[]>,
    label: string,
    chapterId: string,
  ): Promise<{ rows: T[]; failedIds: string[] }> {
    if (ids.length === 0) return { rows: [], failedIds: [] };

    const rows: T[] = [];
    const failedIds: string[] = [];
    const chunks = chunkIds(ids);
    const results = await Promise.allSettled(
      chunks.map((chunk) => load(chunk)),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const chunk = chunks[i];
      if (result.status === 'fulfilled') {
        rows.push(...result.value);
      } else {
        failedIds.push(...chunk);
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'chapter-notify-chunk-lookup-failed',
          message: `Chapter notify ${label} failed for ${chunk.length} recipients in ${chapterId}`,
          error: result.reason,
          tags: { lookup: label },
        });
      }
    }
    if (failedIds.length > 0) {
      this.logger.warn(
        `Chapter notify ${label} failed for ${failedIds.length} of ${ids.length} recipients in ${chapterId}`,
      );
    }
    return { rows, failedIds };
  }

  /**
   * Whether a non-URGENT push to this member goes out SILENT: Do Not Disturb is
   * on, or they are inside their quiet-hours window.
   */
  private isQuieted(settings: UserSettings | null, userId: string): boolean {
    return (
      isDoNotDisturb(settings, new Date()) ||
      this.isInQuietHours(settings, userId)
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
   * runs *before* the notification row is written — so an uncaught throw costs
   * the member the push **and** the in-app row. `notifyUser` would surface that
   * as a thrown delivery; the chapter-wide path evaluates the same helper in
   * memory over batched `user_settings` rows, and used to hide the same throw
   * behind `Promise.allSettled`. Rows predating the `quiet_hours_tz` DTO
   * validation can still carry such a zone, so degrade instead of throwing: a
   * time-shifted quiet window is a far smaller failure than a member whose
   * notifications simply stop.
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

    // The offending row cannot repair itself, and this runs per recipient. A
    // chapter-wide send still evaluates it in memory once per affected member.
    // Warn once per (user, zone) per process so the signal survives without
    // becoming the noise that hides the next problem.
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

  /**
   * The caller's in-app history in this chapter, without the chat rows of a
   * member they have blocked here (#2715).
   *
   * The push worker writes no row for a member who had already blocked the
   * sender (`ChatBlockService.filterOutBlockers`). This covers the rows written
   * before the block, so the history agrees with the thread, which tombstones
   * the same messages. It is read-time, like every other masked surface, so an
   * unblock brings the rows back. A chat row written before the worker recorded
   * its sender is withheld from anyone with a block in the chapter; the
   * repository's filter says why. Non-chat rows are not chat and stay (#2498).
   *
   * The block list read throws on failure, and the throw is not caught: a list
   * that can't be read is not an empty list, and serving the unfiltered history
   * would hand back the very text the block hides.
   */
  async listNotifications(
    userId: string,
    chapterId: string,
    options?: { limit?: number },
  ): Promise<Notification[]> {
    const blocked = await this.chatBlocks.listBlockedUserIds(chapterId, userId);
    return this.notificationRepo.findByUser(userId, chapterId, {
      limit: clampListLimit(options?.limit),
      ...(blocked.length > 0 ? { withholdChatFrom: blocked } : {}),
    });
  }

  async markNotificationRead(
    id: string,
    userId: string,
    chapterId: string,
  ): Promise<Notification> {
    const existing = await this.notificationRepo.findById(id, chapterId);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException('Notification not found');
    }
    // A client can still hold the id of a chat row the list now withholds (it
    // was read before the block), and marking it read must not hand its text
    // back. Read before the write, so an unreadable list changes nothing.
    const blocked = await this.chatBlocks.listBlockedUserIds(chapterId, userId);
    const updated = await this.notificationRepo.markRead(id, userId, chapterId);
    return isWithheldChatRow(updated, blocked)
      ? { ...updated, title: '', body: '' }
      : updated;
  }

  /**
   * Clear the member's chat notifications for a channel they have just read
   * (#3788).
   *
   * A chat push writes a `notifications` row, but the member usually reads
   * the message by opening the channel, not by tapping that row, so the row
   * stayed unread in the inbox long after the messages were seen. Rows
   * created after `readThrough` are left alone: they are about messages the
   * read did not cover.
   */
  async markChatChannelNotificationsRead(
    userId: string,
    chapterId: string,
    channelId: string,
    readThrough: string,
  ): Promise<void> {
    await this.notificationRepo.markChatChannelRead(
      userId,
      chapterId,
      channelId,
      readThrough,
    );
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

  /**
   * Never `null`. It used to be, for a member with no row, and Nest sends `null`
   * as an empty body: `openapi-fetch` read that as `data: undefined`, which
   * TanStack Query refuses, so both clients showed their error state to every
   * member who had never saved (#2885). `findByUser` throws on a failed read, so
   * a `null` here is only ever "no row", and the defaults cannot mask an outage.
   */
  async getSettings(userId: string): Promise<UserSettingsValues> {
    const row = await this.settingsRepo.findByUser(userId);
    return row ? toUserSettingsValues(row) : { ...USER_SETTINGS_DEFAULTS };
  }

  async updateSettings(
    userId: string,
    data: Partial<
      Pick<
        UserSettings,
        | 'quiet_hours_start'
        | 'quiet_hours_end'
        | 'quiet_hours_tz'
        | 'theme'
        | 'status'
        | 'status_expires_at'
        | 'custom_status'
        | 'custom_status_expires_at'
      >
    >,
  ): Promise<UserSettingsValues> {
    const now = new Date();

    // Only what the PATCH names is written (#3845, #3924): `undefined` means
    // "not supplied" and leaves the stored value alone, `null` means "clear
    // this". The repository's upsert then touches no other column, so a save
    // from one device cannot write back a value another device changed after
    // this request began. Test the VALUE, not key presence: class-transformer
    // can materialize a declared DTO property as an own key set to undefined,
    // and keying on presence once made a theme-only PATCH wipe the member's
    // whole quiet-hours window.
    const write: Partial<UserSettingsValues> = {};
    for (const field of [
      'quiet_hours_start',
      'quiet_hours_end',
      'quiet_hours_tz',
    ] as const) {
      if (data[field] !== undefined) write[field] = data[field] ?? null;
    }
    // `!= null`: the DTO's `@IsOptional` lets `theme: null` through, and the
    // column is NOT NULL, so null means "not supplied" here, never a clear.
    if (data.theme != null) write.theme = data.theme;

    // A status and its end time are one choice: picking a status replaces the
    // old end time, so switching from "DND for 1 hour" to Invisible does not
    // end Invisible an hour later. An end time alone has no status to attach
    // to, so it is refused rather than guessed at; a null one alone asks for
    // nothing and is ignored, so it cannot fail the save's other edits. The
    // same holds for the custom line and its end time.
    if (data.status !== undefined && data.status !== null) {
      write.status = data.status;
      write.status_expires_at =
        data.status === 'online' ? null : (data.status_expires_at ?? null);
      assertFutureExpiry('status_expires_at', write.status_expires_at, now);
    } else if (data.status_expires_at != null) {
      throw new BadRequestException(
        'status_expires_at is accepted only together with status',
      );
    }

    if (data.custom_status !== undefined) {
      write.custom_status = data.custom_status ?? null;
      write.custom_status_expires_at =
        write.custom_status === null
          ? null
          : (data.custom_status_expires_at ?? null);
      assertFutureExpiry(
        'custom_status_expires_at',
        write.custom_status_expires_at,
        now,
      );
    } else if (data.custom_status_expires_at != null) {
      throw new BadRequestException(
        'custom_status_expires_at is accepted only together with custom_status',
      );
    }

    const saved = await this.settingsRepo.upsert({ user_id: userId, ...write });
    return toUserSettingsValues(saved, now);
  }
}
