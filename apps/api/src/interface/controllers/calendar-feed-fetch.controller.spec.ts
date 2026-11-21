import {
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import type { Request, Response } from 'express';
import {
  CALENDAR_FEED_HIT_MEMORY_MS,
  CALENDAR_FEED_MISS_LIMIT,
  CalendarFeedFetchController,
} from './calendar-feed-fetch.controller';
import {
  THROTTLED_MESSAGE,
  UNVERIFIED_BEARER_THROTTLER,
} from '../guards/custom-throttler.guard';

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
      // The app's three named buckets, with a limit of two, so a bucket the
      // route did not skip would 429 by the third request. The plain guard
      // counts every request in each bucket it runs, so this pins each skip
      // key, `unverified` included, rather than the app guard's gating.
      imports: [
        ThrottlerModule.forRoot([
          { name: 'read', ttl: 60_000, limit: 2 },
          { name: 'write', ttl: 60_000, limit: 2 },
          { name: UNVERIFIED_BEARER_THROTTLER, ttl: 60_000, limit: 2 },
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

  it('skips every throttle bucket, since calendar servers share addresses', async () => {
    fetch.mockResolvedValue(ICS);
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
        // A calendar app sends none, but a bearer token must not bring the
        // unverified-token bucket into play either.
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(200);
    }
  });

  it('404s a token no link has', async () => {
    fetch.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer())
      .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
      .expect(404);
  });

  // Only lookups that find no link count against an address, and one over
  // its allowance is stopped before the database.
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
        .get(`/v1/calendar-feed/feed.ics?token=${'b'.repeat(43)}`)
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

/**
 * The controller called directly, so a test can set the caller's address and
 * hold lookups open.
 */
describe('CalendarFeedFetchController failed-lookup limit', () => {
  const fetch = jest.fn();
  let controller: CalendarFeedFetchController;

  const token = (n: number): string => n.toString(36).padStart(43, 'x');
  const from = (ip: string) => ({ ip, ips: [] }) as unknown as Request;
  const res = () =>
    ({ header: jest.fn() }) as unknown as Response & { header: jest.Mock };
  const call = (n: number, ip: string, response = res()) =>
    controller.fetch(token(n), from(ip), response);

  beforeEach(() => {
    fetch.mockReset();
    controller = new CalendarFeedFetchController({
      fetch,
    } as unknown as CalendarFeedService);
  });

  const missAll = async (ip: string) => {
    fetch.mockRejectedValue(new NotFoundException());
    for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT; i += 1) {
      await expect(call(i, ip)).rejects.toBeInstanceOf(NotFoundException);
    }
  };

  // A device on an IPv6 network can pick a fresh address inside its /64 for
  // every request, so misses are counted per /64, as the throttler counts.
  it('counts IPv6 callers by their /64', async () => {
    await missAll('2001:db8:aa:bb::1');
    fetch.mockReset();
    fetch.mockResolvedValue(ICS);

    await expect(call(9_999, '2001:db8:aa:bb:ffff::2')).rejects.toMatchObject({
      status: 429,
    });
    expect(fetch).not.toHaveBeenCalled();
    // Another /64 is another network.
    await expect(call(9_999, '2001:db8:aa:cc::1')).resolves.toBe(ICS);
  });

  it('counts lookups still running, so a burst of misses cannot all get through', async () => {
    let missNow!: () => void;
    const held = new Promise<never>((_resolve, reject) => {
      missNow = () => reject(new NotFoundException());
    });
    fetch.mockReturnValue(held);

    const burst = Array.from(
      { length: CALENDAR_FEED_MISS_LIMIT + 10 },
      (_, i) => call(i, '198.51.100.7').catch((error: unknown) => error),
    );
    // Every lookup is still running; only the allowance's worth started.
    expect(fetch).toHaveBeenCalledTimes(CALENDAR_FEED_MISS_LIMIT);
    missNow();
    const outcomes = await Promise.all(burst);
    expect(
      outcomes.filter((error) => error instanceof NotFoundException),
    ).toHaveLength(CALENDAR_FEED_MISS_LIMIT);
    expect(
      outcomes.filter((error) => (error as { status?: number }).status === 429),
    ).toHaveLength(10);
  });

  it('frees a running lookup that found its link for the next one', async () => {
    fetch.mockResolvedValue(ICS);
    for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT + 5; i += 1) {
      await expect(call(i, '198.51.100.8')).resolves.toBe(ICS);
    }
  });

  it('keeps serving a link that served a calendar while its address is over the allowance', async () => {
    const realNow = Date.now.bind(Date);
    const start = realNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);
    try {
      fetch.mockResolvedValueOnce(ICS);
      await expect(call(-1, '198.51.100.9')).resolves.toBe(ICS);

      // Something else on the same network keeps missing.
      await missAll('198.51.100.9');

      fetch.mockReset();
      fetch.mockResolvedValue(ICS);
      // The member's link still works, inside the same minute.
      nowSpy.mockReturnValue(start + 30_000);
      await expect(call(-1, '198.51.100.9')).resolves.toBe(ICS);
      // A link this instance has not served waits for the minute.
      await expect(call(5_000, '198.51.100.9')).rejects.toMatchObject({
        status: 429,
      });

      // Not for longer than the memory lasts since it last served.
      nowSpy.mockReturnValue(start + 30_000 + CALENDAR_FEED_HIT_MEMORY_MS + 1);
      await missAll('198.51.100.9');
      await expect(call(-1, '198.51.100.9')).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not count a lookup the database could not answer', async () => {
    fetch.mockRejectedValue(new ServiceUnavailableException());
    for (let i = 0; i < CALENDAR_FEED_MISS_LIMIT + 5; i += 1) {
      await expect(call(i, '198.51.100.10')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
    fetch.mockResolvedValue(ICS);
    await expect(call(0, '198.51.100.10')).resolves.toBe(ICS);
  });

  it('says when to retry on a refusal', async () => {
    await missAll('198.51.100.11');
    const response = res();
    await expect(call(1, '198.51.100.11', response)).rejects.toMatchObject({
      status: 429,
    });
    expect(response.header).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^[1-9]\d*$/),
    );
  });
});
