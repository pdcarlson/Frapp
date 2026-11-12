import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import {
  GOOGLE_SYNC_WRITE_BUDGET,
  GoogleCalendarSyncService,
} from './google-calendar-sync.service';
import { sealRefreshToken } from './google-calendar-token';
import { toGoogleEvent } from './google-calendar-events';
import { googleCalendarTokenKeyRing } from '../../../config/google-calendar-config';
import {
  GoogleCalendarApiError,
  type GoogleCalendarEventRef,
  type IGoogleCalendarApi,
} from '#domain/adapters/google-calendar.interface';
import type { IGoogleCalendarRepository } from '#domain/repositories/google-calendar.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type { GoogleCalendarConnection } from '#domain/entities/google-calendar-connection.entity';
import type { CalendarFeedService } from '../calendar-feed/calendar-feed.service';
import type { IcsItem } from '../calendar-feed/ics';

const CHAPTER = 'chapter-1';
const USER = 'user-1';
const NOW = new Date('2026-11-12T19:00:00.000Z');
const TOKEN_KEY = `test:${randomBytes(32).toString('base64')}`;
const RING = googleCalendarTokenKeyRing({
  GOOGLE_CALENDAR_TOKEN_KEY: TOKEN_KEY,
});

function item(n: number, overrides: Partial<IcsItem> = {}): IcsItem {
  return {
    uid: `event-${n}@frapp.live`,
    when: {
      kind: 'instant',
      start: '2026-11-20T00:00:00.000Z',
      end: '2026-11-20T01:00:00.000Z',
    },
    summary: `Event ${n}`,
    description: null,
    location: null,
    url: `https://app.frapp.live/events?event=${n}`,
    ...overrides,
  };
}

function connection(
  overrides: Partial<GoogleCalendarConnection> = {},
): GoogleCalendarConnection {
  return {
    id: 'conn-1',
    chapter_id: CHAPTER,
    user_id: USER,
    google_email: 'member@gmail.com',
    refresh_token_sealed: sealRefreshToken(RING, 'refresh-1', CHAPTER, USER),
    calendar_id: 'cal-1',
    status: 'active',
    sync_due_at: NOW.toISOString(),
    sync_lease_until: null,
    last_synced_at: null,
    last_error: null,
    created_at: '2026-11-12T00:00:00.000Z',
    ...overrides,
  };
}

function remoteOf(items: IcsItem[]): GoogleCalendarEventRef[] {
  return items.map((i) => {
    const event = toGoogleEvent(i);
    return {
      id: event.id,
      hash: event.hash,
      endsAt: '2026-11-20T01:00:00.000Z',
    };
  });
}

function setup(items: IcsItem[] = [], remote: GoogleCalendarEventRef[] = []) {
  const repo = {
    setCalendarId: jest.fn(async () => undefined),
    finishSync: jest.fn(async () => undefined),
    markDisconnecting: jest.fn(async () => undefined),
    deferCleanup: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
  const google = {
    accessToken: jest.fn(async () => 'access-1'),
    createCalendar: jest.fn(async () => 'cal-new'),
    deleteCalendar: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
    listEvents: jest.fn(async () => remote),
    insertEvent: jest.fn(async () => undefined),
    updateEvent: jest.fn(async () => undefined),
    deleteEvent: jest.fn(async () => undefined),
  };
  const chapters = {
    findById: jest.fn(async () => ({ id: CHAPTER, name: 'Tau Nu' })),
  };
  const feeds = { memberItems: jest.fn(async () => items) };
  const config = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_CALENDAR_TOKEN_KEY' ? TOKEN_KEY : undefined,
    ),
  } as unknown as ConfigService;
  const service = new GoogleCalendarSyncService(
    repo as unknown as IGoogleCalendarRepository,
    google as unknown as IGoogleCalendarApi,
    chapters as unknown as IChapterRepository,
    feeds as unknown as CalendarFeedService,
    config,
  );
  return { service, repo, google, chapters, feeds };
}

describe('GoogleCalendarSyncService', () => {
  describe('sync', () => {
    it('makes the chapter’s calendar on the first sync and keeps its id at once', async () => {
      const { service, repo, google } = setup([item(1)]);

      const outcome = await service.sync(
        connection({ calendar_id: null }),
        NOW,
      );

      expect(outcome).toBe('synced');
      expect(google.accessToken).toHaveBeenCalledWith('refresh-1');
      expect(google.createCalendar).toHaveBeenCalledWith('access-1', {
        summary: 'Tau Nu (Frapp)',
        description: expect.any(String),
      });
      expect(repo.setCalendarId).toHaveBeenCalledWith('conn-1', 'cal-new');
      expect(google.insertEvent).toHaveBeenCalledWith(
        'access-1',
        'cal-new',
        toGoogleEvent(item(1)),
      );
      expect(repo.finishSync).toHaveBeenCalledWith('conn-1', {
        last_synced_at: NOW.toISOString(),
        last_error: null,
      });
    });

    it('writes only what changed: new inserted, changed updated, unchanged left', async () => {
      const unchanged = item(1);
      const changed = item(2, { summary: 'Moved' });
      const added = item(3);
      const { service, google } = setup(
        [unchanged, changed, added],
        remoteOf([unchanged, item(2)]),
      );

      await service.sync(connection(), NOW);

      expect(
        google.insertEvent.mock.calls.map((c) => (c as unknown[])[2]),
      ).toEqual([toGoogleEvent(added)]);
      expect(
        google.updateEvent.mock.calls.map((c) => (c as unknown[])[2]),
      ).toEqual([toGoogleEvent(changed)]);
      expect(google.deleteEvent).not.toHaveBeenCalled();
    });

    it('deletes what Frapp wrote that is gone, and leaves the member’s own and old events', async () => {
      const gone = remoteOf([item(9)])[0];
      const handAdded = { id: 'members-own', hash: null, endsAt: null };
      const history = {
        id: 'fold',
        hash: 'abc',
        endsAt: '2026-08-01T00:00:00.000Z',
      };
      const { service, google } = setup([], [gone, handAdded, history]);

      await service.sync(connection(), NOW);

      expect(google.deleteEvent).toHaveBeenCalledTimes(1);
      expect(google.deleteEvent).toHaveBeenCalledWith(
        'access-1',
        'cal-1',
        gone.id,
      );
    });

    it('brings back an event the member deleted by hand', async () => {
      const { service, google } = setup([item(1)]);
      google.insertEvent.mockRejectedValue(
        new GoogleCalendarApiError('conflict', 409, 'duplicate'),
      );

      await expect(service.sync(connection(), NOW)).resolves.toBe('synced');
      expect(google.updateEvent).toHaveBeenCalledWith(
        'access-1',
        'cal-1',
        toGoogleEvent(item(1)),
      );
    });

    it('stops at its write budget and comes back at the next tick', async () => {
      const items = Array.from(
        { length: GOOGLE_SYNC_WRITE_BUDGET + 5 },
        (_, n) => item(n),
      );
      const { service, google, repo } = setup(items);

      await expect(service.sync(connection(), NOW)).resolves.toBe('more');
      expect(google.insertEvent).toHaveBeenCalledTimes(
        GOOGLE_SYNC_WRITE_BUDGET,
      );
      expect(repo.finishSync).toHaveBeenCalledWith('conn-1', {
        last_synced_at: NOW.toISOString(),
        last_error: null,
        sync_due_at: NOW.toISOString(),
      });
    });

    it('marks the connection for reconnecting when Google refuses the sign-in', async () => {
      const { service, google, repo } = setup([item(1)]);
      google.accessToken.mockRejectedValue(
        new GoogleCalendarApiError('invalid_grant', 400, 'invalid_grant'),
      );

      await expect(service.sync(connection(), NOW)).resolves.toBe(
        'needs_reconnect',
      );
      expect(repo.finishSync).toHaveBeenCalledWith('conn-1', {
        status: 'needs_reconnect',
        last_error: 'invalid_grant',
      });
    });

    it('marks it for reconnecting when the token was sealed with a key it no longer holds', async () => {
      const { service, google, repo } = setup();

      await expect(
        service.sync(
          connection({ refresh_token_sealed: 'v1.gone.a.b.c' }),
          NOW,
        ),
      ).resolves.toBe('needs_reconnect');
      expect(google.accessToken).not.toHaveBeenCalled();
      expect(repo.finishSync).toHaveBeenCalledWith('conn-1', {
        status: 'needs_reconnect',
        last_error: 'token_unreadable',
      });
    });

    it('disconnects when the member deleted Frapp’s calendar in Google', async () => {
      const { service, google, repo } = setup([item(1)]);
      google.listEvents.mockRejectedValue(
        new GoogleCalendarApiError('not_found', 404, 'notFound'),
      );

      await expect(service.sync(connection(), NOW)).resolves.toBe(
        'calendar_removed',
      );
      expect(repo.markDisconnecting).toHaveBeenCalledWith('conn-1');
      // Nothing left to delete; the sign-in is revoked and the row goes.
      expect(google.deleteCalendar).not.toHaveBeenCalled();
      expect(google.revoke).toHaveBeenCalledWith('refresh-1');
      expect(repo.delete).toHaveBeenCalledWith('conn-1');
    });

    it('does not disconnect when a single event write is not found', async () => {
      const { service, google, repo } = setup(
        [item(1, { summary: 'Changed' })],
        remoteOf([item(1)]),
      );
      google.updateEvent.mockRejectedValue(
        new GoogleCalendarApiError('not_found', 404, 'notFound'),
      );

      await expect(service.sync(connection(), NOW)).resolves.toBe('retry');
      expect(repo.markDisconnecting).not.toHaveBeenCalled();
    });

    it('waits five minutes after a rate limit', async () => {
      const { service, google, repo } = setup([item(1)]);
      google.insertEvent.mockRejectedValue(
        new GoogleCalendarApiError('rate_limited', 429, 'rateLimitExceeded'),
      );

      await expect(service.sync(connection(), NOW)).resolves.toBe('retry');
      expect(repo.finishSync).toHaveBeenCalledWith('conn-1', {
        last_error: 'rateLimitExceeded',
        sync_due_at: '2026-11-12T19:05:00.000Z',
      });
    });
  });

  describe('cleanUp', () => {
    it('removes Frapp’s calendar, revokes the sign-in and drops the row', async () => {
      const { service, google, repo } = setup();

      await service.cleanUp(connection({ status: 'disconnecting' }), NOW);

      expect(google.deleteCalendar).toHaveBeenCalledWith('access-1', 'cal-1');
      expect(google.revoke).toHaveBeenCalledWith('refresh-1');
      expect(repo.delete).toHaveBeenCalledWith('conn-1');
    });

    it('is done when Google already refuses the sign-in', async () => {
      const { service, google, repo } = setup();
      google.accessToken.mockRejectedValue(
        new GoogleCalendarApiError('invalid_grant', 400, 'invalid_grant'),
      );

      await service.cleanUp(connection({ status: 'disconnecting' }), NOW);

      expect(repo.delete).toHaveBeenCalledWith('conn-1');
    });

    it('tries again later when Google can’t be reached', async () => {
      const { service, google, repo } = setup();
      google.revoke.mockRejectedValue(
        new GoogleCalendarApiError('failed', 503, 'backendError'),
      );

      await service.cleanUp(connection({ status: 'disconnecting' }), NOW);

      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.deferCleanup).toHaveBeenCalledWith(
        'conn-1',
        new Date('2026-11-12T19:30:00.000Z'),
        'backendError',
      );
    });

    it('lets go three days after the disconnect was asked for', async () => {
      const { service, google, repo } = setup();
      google.revoke.mockRejectedValue(
        new GoogleCalendarApiError('failed', 503, 'backendError'),
      );

      await service.cleanUp(
        connection({
          status: 'disconnecting',
          sync_due_at: '2026-11-09T18:00:00.000Z',
        }),
        NOW,
      );

      expect(repo.delete).toHaveBeenCalledWith('conn-1');
      expect(repo.deferCleanup).not.toHaveBeenCalled();
    });
  });

  it('process routes a disconnecting connection to cleanup, never to a sync', async () => {
    const { service, feeds, repo } = setup();

    await expect(
      service.process(connection({ status: 'disconnecting' }), NOW),
    ).resolves.toBe('skipped');
    expect(feeds.memberItems).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith('conn-1');
  });
});
