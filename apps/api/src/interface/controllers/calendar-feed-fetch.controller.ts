import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';

/** What `CalendarFeedService` mints: 32 random bytes, base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

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
 * chapter subscribes, as it would Stripe's webhooks. A guess at a token is
 * one indexed lookup against a 256-bit space.
 */
@ApiTags('Calendar feed')
@SkipThrottle({ read: true, write: true })
@Controller('calendar-feed')
export class CalendarFeedFetchController {
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
  fetch(@Query('token') token: unknown): Promise<string> {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) {
      throw new BadRequestException('Not a calendar link');
    }
    return this.feeds.fetch(token);
  }
}
