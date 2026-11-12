import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { CalendarFeedService } from '../../application/services/calendar-feed/calendar-feed.service';
import { CalendarFeedFetchController } from './calendar-feed-fetch.controller';

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarFeedFetchController],
      providers: [{ provide: CalendarFeedService, useValue: { fetch } }],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => fetch.mockReset());

  afterAll(async () => {
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

  it('404s a token no link has', async () => {
    fetch.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer())
      .get(`/v1/calendar-feed/feed.ics?token=${TOKEN}`)
      .expect(404);
  });
});
