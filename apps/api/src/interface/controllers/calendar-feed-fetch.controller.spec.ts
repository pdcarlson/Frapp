import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import {
  CALENDAR_FEED_MISS_LIMIT,
  CalendarFeedFetchController,
} from './calendar-feed-fetch.controller';
import { THROTTLED_MESSAGE } from '../guards/custom-throttler.guard';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

const TOKEN = 'a'.repeat(43);
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

/**
 * Through `configureApp`, so the assertions cover what a calendar app
 * depends on: the `/v1` path, no sign-in, the content type, and a body that
 * is the calendar itself rather than JSON.
 */
describe('GET /v1/calendar-feed/feed.ics', () => {
  let app: INestApplication;
  const fetch = jest.fn();

  // A fresh app per test: the failed-lookup counts live on the controller.
  beforeEach(async () => {
    fetch.mockReset();
    const moduleRef = await Test.createTestingModule({
      // The app's two named buckets, with a limit of two, so a route the
      // throttler did not skip would 429 by the third request.
      imports: [
        ThrottlerModule.forRoot([
          { name: 'read', ttl: 60_000, limit: 2 },
          { name: 'write', ttl: 60_000, limit: 2 },
        ]),
      ],
      controllers: [CalendarFeedFetchController],
      providers: [
        { provide: CalendarFeedService, useValue: { fetch } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the calendar to a caller with no sign-in', async () => {
    fetch.mockResolvedValue(ICS);
    const res = await request(app.getHttpServer())
      .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
      .expect(200);
    expect(fetch).toHaveBeenCalledWith(TOKEN);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).toBe(ICS);
  });

  it.each([
    ['no token', ''],
    ['a short token', '?token=abc'],
    ['a token with other characters', `?token=${'a'.repeat(42)}%2F`],
  ])('refuses %s without a lookup', async (_why, query) => {
    await request(app.getHttpServer())
      .get(`/v1/calendar-feed/feed.ics${query}`)
      .expect(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips both throttle buckets, since calendar servers share addresses', async () => {
    fetch.mockResolvedValue(ICS);
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
        .expect(200);
    }
  });

  it('404s a token no link has', async () => {
    fetch.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer())
      .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
      .expect(404);
  });

  // Only lookups that find no link count against an address, so a calendar
  // server fetching real links is never slowed, and one trying tokens is
  // stopped before the database.
  describe('failed lookups', () => {
    const missUntilLimit = async () => {
      fetch.mockRejectedValue(new NotFoundException());
      for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT; i += 1) {
        await request(app.getHttpServer())
          .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
          .expect(404);
      }
    };

    it('refuses an address that keeps missing, before any lookup, saying when to retry', async () => {
      await missUntilLimit();
      fetch.mockReset();
      fetch.mockResolvedValue(ICS);

      const res = await request(app.getHttpServer())
        .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
        .expect(429);
      expect(fetch).not.toHaveBeenCalled();
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // The route's `@Header` content type rides on its error bodies too, so
      // read the JSON from the text.
      expect(JSON.parse(res.text)).toMatchObject({
        statusCode: 429,
        message: THROTTLED_MESSAGE,
      });
    });

    it('lets the address look up again once the minute is over', async () => {
      const realNow = Date.now.bind(Date);
      const start = realNow();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);
      try {
        await missUntilLimit();
        nowSpy.mockReturnValue(start + 60_000);
        fetch.mockResolvedValue(ICS);
        await request(app.getHttpServer())
          .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
          .expect(200);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('never counts a lookup that found a link', async () => {
      fetch.mockResolvedValue(ICS);
      for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT + 5; i += 1) {
        await request(app.getHttpServer())
          .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
          .expect(200);
      }
    });

    it('does not count a request refused for its shape, which never looks up', async () => {
      for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT + 5; i += 1) {
        await request(app.getHttpServer())
          .get('/v1/calendar-feed/feed.ics?token=abc')
          .expect(400);
      }
      fetch.mockResolvedValue(ICS);
      await request(app.getHttpServer())
        .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
        .expect(200);
    });
  });
});
