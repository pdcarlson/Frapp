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
import { FailedLookupLimiter } from '../utils/failed-lookup-limiter';

/** What `CalendarFeedService` mints: 32 random bytes, base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Lookups that find no link, per address per minute, before that address is
 * refused for the rest of the minute. A calendar app only misses when a link
 * stopped existing (its member deleted their account), and it asks at most
 * hourly per link, so even a calendar server's shared address fetching many
 * such links stays far below this. Product choice.
 */
export const CALENDAR_FEED_MISS_LIMIT = 20;
const MISS_WINDOW_MS = 60_000;
/** Addresses whose misses are counted at once, per API instance. */
const MISS_TRACKED_ADDRESSES = 10_000;

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
 * ({@link CALENDAR_FEED_MISS_LIMIT}): fetching real links never counts, and
 * an address that keeps trying tokens no link has is refused before it
 * reaches the database.
 */
@ApiTags('Calendar feed')
@SkipThrottle({ read: true, write: true, [UNVERIFIED_BEARER_THROTTLER]: true })
@Controller('calendar-feed')
export class CalendarFeedFetchController {
  private readonly misses = new FailedLookupLimiter(
    CALENDAR_FEED_MISS_LIMIT,
    MISS_WINDOW_MS,
    MISS_TRACKED_ADDRESSES,
  );

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
    const address = clientAddress(req);
    const retryAfter = this.misses.retryAfterSeconds(address, Date.now());
    if (retryAfter > 0) {
      res.header('Retry-After', String(retryAfter));
      throw new ThrottlerException(THROTTLED_MESSAGE);
    }
    try {
      return await this.feeds.fetch(token);
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.misses.recordMiss(address, Date.now());
      }
      throw error;
    }
  }
}
