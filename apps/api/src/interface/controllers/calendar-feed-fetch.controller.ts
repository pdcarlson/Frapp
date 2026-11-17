import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import {
  THROTTLED_MESSAGE,
  UNVERIFIED_BEARER_THROTTLER,
  clientAddress,
} from '../guards/custom-throttler.guard';
import {
  FailedLookupLimiter,
  type LookupOutcome,
} from '../utils/failed-lookup-limiter';

/** What `CalendarFeedService` mints: 32 random bytes, base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Lookups that find no link, per address per minute, before that address's
 * further lookups wait for the rest of the minute (lookups still running
 * count too). A link's token is 32 random bytes, so this is not what stops
 * guessing; it bounds how many lookups that find nothing one address can
 * make the database answer. A real calendar app only misses on a link that
 * stopped existing (reset, or its member deleted their account), and fetches
 * each link it holds every few minutes at most (Apple Calendar can be set to
 * every 5 minutes; Google and Outlook fetch from shared pools, less often),
 * so a whole campus network or a provider's fetch address reaches 120 misses
 * a minute only with hundreds of dead links on it. Engineering choice, not a
 * product one.
 */
export const CALENDAR_FEED_MISS_LIMIT = 120;
const MISS_WINDOW_MS = 60_000;
/** Addresses whose misses are counted at once, per API instance. */
const MISS_TRACKED_ADDRESSES = 10_000;
/**
 * How long a link that served a calendar keeps working from an address that
 * is over its miss allowance: a day, longer than any calendar app waits
 * between fetches, so a member's live link is not cut off by dead links or
 * stray requests from others on the same address.
 */
export const CALENDAR_FEED_HIT_MEMORY_MS = 24 * 60 * 60 * 1000;
/** Links remembered that way at once, per API instance. */
const REMEMBERED_LINKS = 20_000;

/**
 * The calendar a subscription link serves (#3322;
 * `spec/behavior/events.md` § Calendar subscription).
 *
 * No auth guard, deliberately: the caller is Apple's, Google's or
 * Microsoft's calendar server, which sends no sign-in. The token in the
 * query is the whole credential, as an invite's token is; it is in the
 * query, not the path, because the request log and Sentry keep only a
 * request's path.
 *
 * `@SkipThrottle`: Google fetches every member's subscription from a shared
 * pool of addresses, so the per-address read limit would refuse it once a
 * chapter subscribes, as it would Stripe's webhooks. What is limited per
 * address instead is lookups that find no link
 * ({@link CALENDAR_FEED_MISS_LIMIT}): a lookup that finds a link never
 * counts, an address over its allowance is refused before the database, and
 * a link that served a calendar in the last day is still served to it
 * ({@link CALENDAR_FEED_HIT_MEMORY_MS}).
 */
@ApiTags('Calendar feed')
@SkipThrottle({ read: true, write: true, [UNVERIFIED_BEARER_THROTTLER]: true })
@Controller('calendar-feed')
export class CalendarFeedFetchController {
  private readonly misses = new FailedLookupLimiter({
    limit: CALENDAR_FEED_MISS_LIMIT,
    windowMs: MISS_WINDOW_MS,
    maxAddresses: MISS_TRACKED_ADDRESSES,
    rememberHitsMs: CALENDAR_FEED_HIT_MEMORY_MS,
    maxRememberedHits: REMEMBERED_LINKS,
  });

  constructor(private readonly feeds: CalendarFeedService) {}

  @Get('feed.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  // Per member, so no shared cache (Render fronts the API with a CDN) may
  // keep it; a calendar app asks again on its own schedule.
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'The iCalendar feed behind a calendar subscription link. Called by calendar apps, not by Frapp clients.',
  })
  @ApiQuery({ name: 'token', required: true })
  @ApiProduces('text/calendar')
  @ApiNotFoundResponse({ description: 'No link has this token.' })
  async fetch(
    @Query('token') token: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) {
      throw new BadRequestException('Not a calendar link');
    }
    const address = clientAddress(req) ?? 'unknown';
    const retryAfter = this.misses.reserve(address, token, Date.now());
    if (retryAfter > 0) {
      res.header('Retry-After', String(retryAfter));
      throw new ThrottlerException(THROTTLED_MESSAGE);
    }
    let outcome: LookupOutcome = 'failed';
    try {
      const ics = await this.feeds.fetch(token);
      outcome = 'found';
      return ics;
    } catch (error) {
      // Only "no link has this token" is a miss. Any other failure (the
      // database unreachable) says nothing about the link either way.
      if (error instanceof NotFoundException) {
        outcome = 'missed';
      }
      throw error;
    } finally {
      this.misses.settle(address, token, outcome, Date.now());
    }
  }
}
