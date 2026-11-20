import { createHash, randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
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
import { TaskStatus, type TaskView } from '#domain/entities/task.entity';
import { EventService } from '../event.service';
import { TaskService } from '../task.service';
import { RbacService } from '../rbac.service';
import { memberAttendance } from '../event-role-targeting';
import { apiBaseUrl } from '../discord-oauth.service';
import { resolveAppOrigin } from '../../../infrastructure/email/invite-link.util';
import { buildIcsCalendar, type IcsItem } from './ics';
import { calendarFeedTokenKeyRing } from '../../../config/calendar-feed-config';
import {
  AiTextCipherError,
  openAiText,
  sealAiText,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';

/** What a link is looked up by: the sha256 of its token, hex. */
export function calendarFeedTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Binds a sealed token to its link's chapter and member, so a sealed value
 * copied onto another member's row does not open.
 */
function sealContext(chapterId: string, userId: string): string {
  return `calendar-feed:${chapterId}:${userId}`;
}

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
export const CALENDAR_PAST_DAYS = 60;
/** How far ahead: a full year, so a recurring series' months ahead show. */
const FUTURE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Open tasks a feed carries at most; far more than a member has open. */
const TASK_LIMIT = 500;
/**
 * How long a rendered calendar is reused. The feed asks calendar apps to check
 * hourly (`REFRESH-INTERVAL` in `ics.ts`), and a member who set their app to
 * check more often (Apple Calendar allows every 5 minutes) sees a change at
 * most this much later.
 */
const RENDER_TTL_MS = 5 * 60 * 1000;
/** Links whose render is kept at once, per API instance. */
const RENDER_CACHE_MAX = 2000;
/** Links from before sealing that the boot pass seals per read. */
const LEGACY_BATCH = 100;
/**
 * Reads the boot pass makes at most, far above the one row per member per
 * chapter the table holds, so a write that somehow leaves a row unsealed
 * can't keep it reading the same rows forever.
 */
const LEGACY_MAX_BATCHES = 500;

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
export class CalendarFeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CalendarFeedService.name);
  private readonly apiBase: string | null;
  private readonly appOrigin: string;
  private readonly keyRing: AiTextKeyRing | null;
  /** Rendered calendars by token hash, so no plaintext token is kept here. */
  private readonly rendered = new Map<string, { ics: string; until: number }>();

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
    this.keyRing = calendarFeedTokenKeyRing({
      CALENDAR_FEED_TOKEN_KEY: config.get<string>('CALENDAR_FEED_TOKEN_KEY'),
    });
  }

  /**
   * Seals every link made before tokens were sealed, so none keeps its token
   * readable until it happens to be fetched or shown. In the background and
   * best effort: boot doesn't wait, a failure is logged, and the next boot or
   * the link's next fetch picks up what is left. Several instances may run
   * it at once; a link already sealed is left as it is.
   */
  onApplicationBootstrap(): void {
    const ring = this.keyRing;
    if (!ring) return;
    void this.sealAllLegacy(ring).catch((error: unknown) => {
      this.logger.warn(
        `calendar-feed: sealing older links stopped (${describeFailure(error)})`,
      );
    });
  }

  /** Seals legacy links in batches until none is left; returns how many. */
  async sealAllLegacy(ring: AiTextKeyRing): Promise<number> {
    let sealed = 0;
    for (let read = 0; read < LEGACY_MAX_BATCHES; read += 1) {
      const batch = await this.feeds.findLegacy(LEGACY_BATCH);
      for (const feed of batch) {
        if (feed.token === null) continue;
        await this.feeds.sealLegacy(
          feed.id,
          sealAiText(
            ring,
            feed.token,
            sealContext(feed.chapter_id, feed.user_id),
          ),
        );
        sealed += 1;
      }
      if (batch.length < LEGACY_BATCH) return sealed;
    }
    return sealed;
  }

  /** The member's link, made on first ask. Asking again returns the same one. */
  async ensure(chapterId: string, userId: string): Promise<CalendarFeedLink> {
    const base = this.requireApiBase();
    const live = await this.feeds.findLive(chapterId, userId);
    if (live) {
      const token = await this.shownToken(live);
      if (token !== null) return this.linkFor(base, token);
      // Its sealed copy no longer opens (its key was dropped), so it can't be
      // shown again: cut it off and hand out a new one, rather than leave the
      // member a menu that fails every time with no way to reset.
      await this.feeds.revokeLive(chapterId, userId);
      this.rendered.delete(live.token_hash);
    }
    return this.linkFor(base, await this.mintOrWinner(chapterId, userId));
  }

  /**
   * A new link, and the old one emptied: a calendar subscribed to the old link
   * shows nothing from the next time it checks (`fetch`). Cutting the old
   * link off needs no key, so it happens first: a leaked link stops even on a
   * server that can't make a new one (that part answers 503).
   */
  async reset(chapterId: string, userId: string): Promise<CalendarFeedLink> {
    const base = this.requireApiBase();
    const old = await this.feeds.findLive(chapterId, userId);
    await this.feeds.revokeLive(chapterId, userId);
    if (old) this.rendered.delete(old.token_hash);
    return this.linkFor(base, await this.mintOrWinner(chapterId, userId));
  }

  /**
   * A new link's token. When the insert is refused because another request
   * (a second device, a reset racing an `ensure`) made the member's live link
   * first, the one that won.
   */
  private async mintOrWinner(
    chapterId: string,
    userId: string,
  ): Promise<string> {
    const ring = this.requireKeyRing();
    try {
      return await this.mint(ring, chapterId, userId);
    } catch (error) {
      const winner = await this.feeds.findLive(chapterId, userId);
      const token = winner ? await this.shownToken(winner) : null;
      if (token !== null) return token;
      throw error;
    }
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
    const hash = calendarFeedTokenHash(token);
    const cached = this.rendered.get(hash);
    if (cached && cached.until > now.getTime()) return cached.ics;

    const feed = await this.feeds.findByTokenHash(hash);
    if (!feed) throw new NotFoundException('Calendar link not found');
    // A link made before tokens were sealed: the request carries its token,
    // so seal it now. A calendar app fetches its links every few hours, so
    // every link in use converts within a day.
    if (feed.token !== null && this.keyRing) {
      await this.sealLegacy(this.keyRing, feed, token);
    }

    const chapter = await this.chapters.findById(feed.chapter_id);
    const name = chapter ? `${chapter.name} (Frapp)` : 'Frapp';
    const items = chapter ? await this.itemsFor(feed, chapter, now) : [];
    const ics = buildIcsCalendar({ name, items, now });
    this.remember(hash, ics, now);
    return ics;
  }

  /**
   * Keeps a rendered calendar for {@link RENDER_TTL_MS}. The route is open to
   * anyone holding a link and unthrottled (calendar servers share addresses),
   * so a link fetched in a loop, by a misbehaving client or whoever it leaked
   * to, costs one render per window instead of a round of queries per
   * request. Oldest first out once {@link RENDER_CACHE_MAX} links are held.
   */
  private remember(hash: string, ics: string, now: Date): void {
    this.rendered.delete(hash);
    if (this.rendered.size >= RENDER_CACHE_MAX) {
      const oldest = this.rendered.keys().next().value;
      if (oldest !== undefined) this.rendered.delete(oldest);
    }
    this.rendered.set(hash, { ics, until: now.getTime() + RENDER_TTL_MS });
  }

  private async itemsFor(
    feed: CalendarFeed,
    chapter: Chapter,
    now: Date,
  ): Promise<IcsItem[]> {
    if (feed.revoked_at) return [];
    return this.memberItems(chapter, feed.user_id, now);
  }

  /** Whether the user is still a member of the chapter. */
  async isMember(chapterId: string, userId: string): Promise<boolean> {
    return (
      (await this.members.findByUserAndChapter(userId, chapterId)) !== null
    );
  }

  /**
   * What a member's calendar holds in a chapter: the events they may see from
   * {@link CALENDAR_PAST_DAYS} back to {@link FUTURE_DAYS} ahead, and their open
   * tasks. Empty when they left the chapter or lost `members:view`. The
   * subscription link serves it, and the Google Calendar sync writes it
   * (`GoogleCalendarSyncService`), so the two always agree.
   */
  async memberItems(
    chapter: Chapter,
    userId: string,
    now: Date,
  ): Promise<IcsItem[]> {
    const chapterId = chapter.id;
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
            endsAfter: new Date(
              now.getTime() - CALENDAR_PAST_DAYS * DAY_MS,
            ).toISOString(),
            startsBefore: new Date(
              now.getTime() + FUTURE_DAYS * DAY_MS,
            ).toISOString(),
          })
        : Promise.resolve([]),
      isModuleEnabled(modules, 'tasks')
        ? // Unconfirmed only: a confirmed task is done, and leaving them out
          // in SQL keeps a long-time member's history out of every fetch.
          this.tasks.list(chapterId, userId, false, {
            confirmed: false,
            limit: TASK_LIMIT,
          })
        : Promise.resolve([]),
      this.rbac.getAlumniRoleId(chapterId),
    ]);

    return [
      ...events.map((event) =>
        this.eventItem(
          event,
          memberAttendance(event, member.role_ids, alumniRoleId) === 'required',
        ),
      ),
      ...tasks
        // A task with no due date has no day to sit on (#5761).
        .filter(
          (task): task is TaskView & { due_date: string } =>
            task.status !== TaskStatus.COMPLETED && task.due_date !== null,
        )
        .map((task) => this.taskItem(task)),
    ];
  }

  private eventItem(event: Event, required: boolean): IcsItem {
    // The web deep-link contract, `eventDeepLink` in
    // apps/web/lib/events/event-links.ts: the Events page opens the event.
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

  private taskItem(task: TaskView & { due_date: string }): IcsItem {
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

  /** A new link; returns its token, which is stored only hashed and sealed. */
  private async mint(
    ring: AiTextKeyRing,
    chapterId: string,
    userId: string,
  ): Promise<string> {
    // 256 bits: the URL is the whole credential.
    const token = randomBytes(32).toString('base64url');
    await this.feeds.create({
      chapter_id: chapterId,
      user_id: userId,
      token_hash: calendarFeedTokenHash(token),
      token_sealed: sealAiText(ring, token, sealContext(chapterId, userId)),
    });
    return token;
  }

  /**
   * The token a stored link carries, to show it again: a legacy plaintext
   * (sealed on the way, when there is a key), or its sealed copy opened.
   * Null when the sealed copy won't open, which only a dropped key causes.
   * A sealed link with no key on this server answers 503.
   */
  private async shownToken(feed: CalendarFeed): Promise<string | null> {
    if (feed.token !== null) {
      if (this.keyRing) await this.sealLegacy(this.keyRing, feed, feed.token);
      return feed.token;
    }
    const ring = this.requireKeyRing();
    if (feed.token_sealed === null) return null;
    try {
      return openAiText(
        ring,
        feed.token_sealed,
        sealContext(feed.chapter_id, feed.user_id),
      );
    } catch (error) {
      this.logger.warn(
        `calendar-feed: a sealed link didn't open (${describeFailure(error)}); reissuing it`,
      );
      return null;
    }
  }

  /**
   * Seal a legacy link's plaintext token and clear it. Best effort: a failure
   * leaves the link as it was, still working, to be sealed on its next fetch.
   */
  private async sealLegacy(
    ring: AiTextKeyRing,
    feed: CalendarFeed,
    token: string,
  ): Promise<void> {
    try {
      await this.feeds.sealLegacy(
        feed.id,
        sealAiText(ring, token, sealContext(feed.chapter_id, feed.user_id)),
      );
    } catch (error) {
      this.logger.warn(
        `calendar-feed: sealing a legacy link failed (${describeFailure(error)})`,
      );
    }
  }

  private linkFor(base: string, token: string): CalendarFeedLink {
    // The token rides in the query, not the path: the API's request log and
    // Sentry keep a request's path and drop its query, so the credential
    // never lands in either.
    const url = `${base}/v1/calendar-feed/feed.ics?${new URLSearchParams({
      token,
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

  /**
   * Without `CALENDAR_FEED_TOKEN_KEY` a new link can't be stored sealed, and
   * a link stored sealed can't be shown again, so both are refused. Links
   * already handed out still fetch: the lookup needs only the hash.
   */
  private requireKeyRing(): AiTextKeyRing {
    if (!this.keyRing) {
      throw new ServiceUnavailableException(
        'Calendar links are not set up on this server.',
      );
    }
    return this.keyRing;
  }
}

/**
 * What a log line says about a failure: the cipher's reason, or the error's
 * name and its SQLSTATE when the database refused. Never a value.
 */
function describeFailure(error: unknown): string {
  if (error instanceof AiTextCipherError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name : 'unknown';
  return typeof code === 'string' ? `${name} ${code}` : name;
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
