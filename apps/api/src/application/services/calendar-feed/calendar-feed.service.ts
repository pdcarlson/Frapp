import { randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isModuleEnabled } from '@repo/validation';
import { CALENDAR_FEED_REPOSITORY } from '#domain/repositories/calendar-feed.repository.interface';
import type { ICalendarFeedRepository } from '#domain/repositories/calendar-feed.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import type { CalendarFeed } from '#domain/entities/calendar-feed.entity';
import type { Chapter } from '#domain/entities/chapter.entity';
import type { Event } from '#domain/entities/event.entity';
import { TaskStatus, type Task } from '#domain/entities/task.entity';
import { EventService } from '../event.service';
import { TaskService } from '../task.service';
import { RbacService } from '../rbac.service';
import { memberAttendance } from '../event-role-targeting';
import { apiBaseUrl } from '../discord-oauth.service';
import { resolveAppOrigin } from '../../../infrastructure/email/invite-link.util';
import { buildIcsCalendar, type IcsItem } from './ics';

/** What the member's menu shows: the link, in the two forms it hands out. */
export interface CalendarFeedLink {
  /** `https://…/v1/calendar-feed/feed.ics?token=…`: Google, Outlook, copying. */
  url: string;
  /** The same link as `webcal://`: Apple Calendar opens it as a subscription. */
  webcal_url: string;
}

/**
 * How far back a feed reaches. Far enough that last week's events stay on the
 * calendar (a member checks what they went to); not the chapter's whole
 * history, which a calendar app would re-read on every fetch.
 */
const PAST_DAYS = 60;
/** How far ahead: a full year, so a recurring series' months ahead show. */
const FUTURE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar subscription links (#3322, step 1;
 * `spec/behavior/events.md` § Calendar subscription).
 *
 * A member gets one private link per chapter. Fetching it reads the chapter's
 * events and the member's open tasks fresh, by the same rules as the app's own
 * reads: the events the member may see (`EventService.findByChapter` with the
 * member as viewer), and the tasks assigned to them (`TaskService.list` as a
 * non-manager). Nothing is copied out ahead of time, so an edit, a cancelled
 * event or a role change reaches the calendar at its next check.
 */
@Injectable()
export class CalendarFeedService {
  private readonly apiBase: string | null;
  private readonly appOrigin: string;

  constructor(
    @Inject(CALENDAR_FEED_REPOSITORY)
    private readonly feeds: ICalendarFeedRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapters: IChapterRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly members: IMemberRepository,
    private readonly rbac: RbacService,
    private readonly events: EventService,
    private readonly tasks: TaskService,
    config: ConfigService,
  ) {
    this.apiBase = apiBaseUrl(config.get<string>('API_URL'));
    this.appOrigin = resolveAppOrigin(config);
  }

  /** The member's link, made on first ask. Asking again returns the same one. */
  async ensure(chapterId: string, userId: string): Promise<CalendarFeedLink> {
    const base = this.requireApiBase();
    const live = await this.feeds.findLive(chapterId, userId);
    if (live) return this.linkFor(base, live);
    try {
      return this.linkFor(base, await this.mint(chapterId, userId));
    } catch (error) {
      // Two devices asking at once: the partial unique index lets one insert
      // win, and the other reads what it made.
      const winner = await this.feeds.findLive(chapterId, userId);
      if (winner) return this.linkFor(base, winner);
      throw error;
    }
  }

  /**
   * A new link, and the old one emptied: a calendar subscribed to the old link
   * shows nothing from the next time it checks (`fetch`).
   */
  async reset(chapterId: string, userId: string): Promise<CalendarFeedLink> {
    const base = this.requireApiBase();
    await this.feeds.revokeLive(chapterId, userId);
    return this.linkFor(base, await this.mint(chapterId, userId));
  }

  /**
   * The calendar a link serves, as iCalendar text.
   *
   * An unknown token is a 404. A known one always answers with a calendar,
   * empty when the link was reset, the member left the chapter or lost
   * `members:view` (which every read of events and tasks needs), so the
   * calendar app clears what it holds instead of keeping a stale copy, which
   * it does when a fetch fails.
   */
  async fetch(token: string, now: Date = new Date()): Promise<string> {
    const feed = await this.feeds.findByToken(token);
    if (!feed) throw new NotFoundException('Calendar link not found');

    const chapter = await this.chapters.findById(feed.chapter_id);
    const name = chapter ? `${chapter.name} (Frapp)` : 'Frapp';
    const items = chapter ? await this.itemsFor(feed, chapter, now) : [];
    return buildIcsCalendar({
      name,
      items,
      now,
    });
  }

  private async itemsFor(
    feed: CalendarFeed,
    chapter: Chapter,
    now: Date,
  ): Promise<IcsItem[]> {
    if (feed.revoked_at) return [];
    const { chapter_id: chapterId, user_id: userId } = feed;
    const member = await this.members.findByUserAndChapter(userId, chapterId);
    if (!member) return [];
    const canRead = await this.rbac.memberHasAnyPermission(chapterId, userId, [
      SystemPermissions.MEMBERS_VIEW,
    ]);
    if (!canRead) return [];

    const modules = chapter.enabled_modules ?? null;
    const [events, tasks, alumniRoleId] = await Promise.all([
      isModuleEnabled(modules, 'events')
        ? this.events.findByChapter(chapterId, userId, {
            endsAfter: new Date(now.getTime() - PAST_DAYS * DAY_MS).toISOString(),
            startsBefore: new Date(
              now.getTime() + FUTURE_DAYS * DAY_MS,
            ).toISOString(),
          })
        : Promise.resolve([]),
      isModuleEnabled(modules, 'tasks')
        ? this.tasks.list(chapterId, userId, false)
        : Promise.resolve([]),
      this.rbac.getAlumniRoleId(chapterId),
    ]);

    return [
      ...events.map((event) =>
        this.eventItem(
          event,
          memberAttendance(event, member.role_ids, alumniRoleId) ===
            'required',
        ),
      ),
      ...tasks
        .filter((task) => task.status !== TaskStatus.COMPLETED)
        .map((task) => this.taskItem(task)),
    ];
  }

  private eventItem(event: Event, required: boolean): IcsItem {
    const url = `${this.appOrigin}/events?${new URLSearchParams({
      event: event.id,
    }).toString()}`;
    return {
      uid: `event-${event.id}@frapp.live`,
      when: { kind: 'instant', start: event.start_time, end: event.end_time },
      summary: event.name,
      location: event.location,
      description: describe(url, [
        required ? 'Required' : null,
        event.description,
      ]),
      url,
    };
  }

  private taskItem(task: Task): IcsItem {
    const url = `${this.appOrigin}/tasks`;
    return {
      uid: `task-${task.id}@frapp.live`,
      // A task with a time sits at that moment, as a calendar shows a
      // deadline; one without, on its day.
      when: task.due_at
        ? { kind: 'instant', start: task.due_at, end: task.due_at }
        : { kind: 'day', date: task.due_date.slice(0, 10) },
      summary: `Due: ${task.title}`,
      location: null,
      description: describe(url, [task.description]),
      url,
    };
  }

  private async mint(chapterId: string, userId: string): Promise<CalendarFeed> {
    return this.feeds.create({
      chapter_id: chapterId,
      user_id: userId,
      // 256 bits: the URL is the whole credential.
      token: randomBytes(32).toString('base64url'),
    });
  }

  private linkFor(base: string, feed: CalendarFeed): CalendarFeedLink {
    // The token rides in the query, not the path: the API's request log and
    // Sentry keep a request's path and drop its query, so the credential
    // never lands in either.
    const url = `${base}/v1/calendar-feed/feed.ics?${new URLSearchParams({
      token: feed.token,
    }).toString()}`;
    return { url, webcal_url: url.replace(/^https?:\/\//, 'webcal://') };
  }

  /**
   * Without `API_URL` there is no address a calendar app could fetch, so the
   * link is refused rather than handed out pointing nowhere.
   */
  private requireApiBase(): string {
    if (!this.apiBase) {
      throw new ServiceUnavailableException(
        'Calendar links are not set up on this server.',
      );
    }
    return this.apiBase;
  }
}

/**
 * The description a calendar shows: the link back to Frapp first (Google
 * shows `URL` to the calendar's owner only, and not in every view), then the
 * rest, blank-line separated.
 */
function describe(url: string, parts: (string | null)[]): string {
  const rest = parts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return [`Open in Frapp: ${url}`, ...rest].join('\n\n');
}
