import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { birthdayDateInYear } from '@repo/validation';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  type IChatChannelRepository,
  type IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import {
  USER_SETTINGS_REPOSITORY,
  type IUserSettingsRepository,
} from '#domain/repositories/notification.repository.interface';
import type { UserSharedBirthday } from '#domain/entities/user.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * The hour, in the member's own time zone, from which their birthday post
 * may go out: morning, not midnight, the way a Discord birthday bot posts in
 * each member's zone.
 */
export const BIRTHDAY_POST_HOUR = 9;
/** Where a member who never reported a time zone is placed. */
export const BIRTHDAY_FALLBACK_TIME_ZONE = 'America/New_York';

/** A birthday whose post is due now: who, and their local date. */
export interface DueBirthday {
  userId: string;
  name: string;
  /** `YYYY-MM-DD` in the member's own zone, the post's once-a-day key. */
  localDate: string;
}

/** The date and hour `now` reads as in `timeZone`, or null for a bad zone. */
function localClock(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: string) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    return {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour'),
    };
  } catch {
    return null;
  }
}

/**
 * The birthdays whose post is due at `now`: today in the member's own zone
 * (29 February on 28 February outside leap years) and past
 * {@link BIRTHDAY_POST_HOUR} there. Exported for its spec.
 */
export function dueBirthdays(
  birthdays: readonly UserSharedBirthday[],
  zoneOf: (userId: string) => string | null | undefined,
  now: Date,
): DueBirthday[] {
  const due: DueBirthday[] = [];
  for (const birthday of birthdays) {
    const clock =
      localClock(now, zoneOf(birthday.id) ?? BIRTHDAY_FALLBACK_TIME_ZONE) ??
      localClock(now, BIRTHDAY_FALLBACK_TIME_ZONE);
    if (!clock || clock.hour < BIRTHDAY_POST_HOUR) continue;
    const { month, day } = birthdayDateInYear(
      birthday.birthday_month,
      birthday.birthday_day,
      clock.year,
    );
    if (month !== clock.month || day !== clock.day) continue;
    const name = birthday.display_name.trim();
    if (!name) continue;
    due.push({
      userId: birthday.id,
      name,
      localDate: `${clock.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    });
  }
  return due;
}

/** The post itself, sent as Frapp. */
export function birthdayPostContent(name: string): string {
  return `Happy birthday, ${name}! 🎂`;
}

/**
 * The happy-birthday posts (#4959, `spec/behavior/members.md` § Profiles):
 * once a day for each member who shares their birthday with the chapter, in
 * the channel an officer picked (`chapters.birthday_channel_id`), sent as
 * Frapp. A chapter with no channel picked posts nothing.
 *
 * Runs on every API replica. Each post is written with a `client_message_id`
 * of the member and their local date, and the message table's dedupe key
 * (`insertIdempotent`) lets exactly one replica's write land, so a member is
 * congratulated once however many replicas tick, and a tick that fails part
 * way is simply finished by the next. Ticks on one replica don't overlap.
 */
@Injectable()
export class BirthdayPostSweepService {
  private readonly logger = new Logger(BirthdayPostSweepService.name);
  private running = false;

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(USER_SETTINGS_REPOSITORY)
    private readonly settingsRepo: IUserSettingsRepository,
  ) {}

  @ReportedCron(CronExpression.EVERY_30_MINUTES)
  async handleBirthdayPosts(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  /** One pass over every chapter with a channel. Exported for its spec. */
  async sweep(now: Date): Promise<number> {
    const chapters = await this.chapterRepo.findWithBirthdayChannel();
    let posted = 0;
    for (const chapter of chapters) {
      try {
        posted += await this.sweepChapter(
          chapter.id,
          chapter.birthday_channel_id,
          now,
        );
      } catch (error) {
        // One chapter's failure doesn't hold back the rest; its posts are
        // tried again next tick.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'birthday-post-sweep',
          message: `birthday posts failed for chapter ${chapter.id}; tried again next tick`,
          error,
        });
      }
    }
    return posted;
  }

  private async sweepChapter(
    chapterId: string,
    channelId: string,
    now: Date,
  ): Promise<number> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    // Saved as a public channel; one made private or archived since stops
    // the posts rather than sending them somewhere the chapter can't see.
    if (!channel || channel.archived_at || channel.type !== 'PUBLIC') return 0;

    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return 0;
    const userIds = [...new Set(members.map((member) => member.user_id))];
    const birthdays = await this.userRepo.findSharedBirthdaysByIds(userIds);
    if (!birthdays.length) return 0;

    const settings = await this.settingsRepo.findByUserIds(
      birthdays.map((birthday) => birthday.id),
    );
    const zones = new Map(
      settings.map((row) => [row.user_id, row.time_zone ?? null]),
    );
    let posted = 0;
    for (const due of dueBirthdays(birthdays, (id) => zones.get(id), now)) {
      const result = await this.messageRepo.insertIdempotent({
        channel_id: channel.id,
        sender_id: SYSTEM_SENDER_ID,
        content: birthdayPostContent(due.name),
        kind: 'text',
        client_message_id: `birthday:${due.userId}:${due.localDate}`,
      });
      if (result === 'inserted') posted += 1;
    }
    return posted;
  }
}
