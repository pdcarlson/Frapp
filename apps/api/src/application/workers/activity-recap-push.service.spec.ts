import {
  ActivityRecapPushService,
  RECAP_NOTIFICATION_CATEGORY,
  recapPushBody,
  recapPushSeason,
  recapPushWeek,
} from './activity-recap-push.service';
import type { ActivityRecap } from '../services/activity-recap.service';
import { localMidnight } from '../services/local-clock';

/** 2026-11-15 and 2026-11-08 are Sundays; 2026-11-01 is the US clock change. */
describe('recapPushWeek (#4985)', () => {
  it("is due on Sunday from 9 AM to noon in the member's zone", () => {
    // 14:30 UTC is 09:30 in New York (EST).
    expect(
      recapPushWeek(new Date('2026-11-15T14:30:00Z'), 'America/New_York'),
    ).toEqual({
      weekStart: new Date('2026-11-15T05:00:00Z'),
      lastWeekStart: new Date('2026-11-08T05:00:00Z'),
      firstDay: '2026-11-08',
    });
    // 08:30 and 12:00 there: outside the window.
    expect(
      recapPushWeek(new Date('2026-11-15T13:30:00Z'), 'America/New_York'),
    ).toBeNull();
    expect(
      recapPushWeek(new Date('2026-11-15T17:00:00Z'), 'America/New_York'),
    ).toBeNull();
    // Monday morning: not the first day of the week.
    expect(
      recapPushWeek(new Date('2026-11-16T14:30:00Z'), 'America/New_York'),
    ).toBeNull();
  });

  it("reads Sunday in the member's zone, not UTC's", () => {
    // Saturday 22:30 UTC is Sunday 09:30 in Sydney (UTC+11 in November).
    const now = new Date('2026-11-14T22:30:00Z');
    expect(recapPushWeek(now, 'Australia/Sydney')).toEqual({
      weekStart: new Date('2026-11-14T13:00:00Z'),
      lastWeekStart: new Date('2026-11-07T13:00:00Z'),
      firstDay: '2026-11-08',
    });
    expect(recapPushWeek(now, 'UTC')).toBeNull();
  });

  it('starts a week that crossed a clock change at its own midnight', () => {
    // Sunday Nov 8, 09:30 EST. The week began Sunday Nov 1 at midnight EDT
    // (04:00 UTC), an hour longer than seven days back.
    expect(
      recapPushWeek(new Date('2026-11-08T14:30:00Z'), 'America/New_York'),
    ).toEqual({
      weekStart: new Date('2026-11-08T05:00:00Z'),
      lastWeekStart: new Date('2026-11-01T04:00:00Z'),
      firstDay: '2026-11-01',
    });
  });

  it('falls back to New York for no zone or one that does not resolve', () => {
    const now = new Date('2026-11-15T14:30:00Z');
    expect(recapPushWeek(now, null)?.firstDay).toBe('2026-11-08');
    expect(recapPushWeek(now, 'Not/AZone')?.firstDay).toBe('2026-11-08');
  });
});

describe('localMidnight', () => {
  it('is the local midnight on the day of a clock change', () => {
    // US clocks went back at 2 AM on Nov 1: midnight was still EDT.
    expect(localMidnight(2026, 11, 1, 'America/New_York')).toEqual(
      new Date('2026-11-01T04:00:00Z'),
    );
    expect(localMidnight(2026, 11, 2, 'America/New_York')).toEqual(
      new Date('2026-11-02T05:00:00Z'),
    );
  });
});

describe('recapPushSeason', () => {
  it('is open while it is Sunday morning somewhere, and closed otherwise', () => {
    expect(recapPushSeason(new Date('2026-11-14T18:59:00Z'))).toBe(false);
    expect(recapPushSeason(new Date('2026-11-14T19:00:00Z'))).toBe(true);
    expect(recapPushSeason(new Date('2026-11-15T23:59:00Z'))).toBe(true);
    expect(recapPushSeason(new Date('2026-11-16T00:00:00Z'))).toBe(false);
    expect(recapPushSeason(new Date('2026-11-18T12:00:00Z'))).toBe(false);
  });
});

const recap = (overrides: Partial<ActivityRecap> = {}): ActivityRecap => ({
  start: '2026-11-08T05:00:00.000Z',
  end: '2026-11-15T05:00:00.000Z',
  events_attended: 0,
  tasks_done: 0,
  points: 0,
  service_minutes: 0,
  study_minutes: 0,
  unavailable: [],
  ...overrides,
});

describe('recapPushBody', () => {
  it("says the card's figures in its words, leaving out what is off or zero", () => {
    expect(
      recapPushBody(
        recap({
          events_attended: 3,
          tasks_done: 1,
          points: 15,
          service_minutes: 240,
          study_minutes: 90,
        }),
      ),
    ).toBe(
      '3 events · 1 task done · +15 points · 4h of service · 1h 30m studied',
    );
    expect(
      recapPushBody(
        recap({ events_attended: 1, tasks_done: null, points: -1 }),
      ),
    ).toBe('1 event · -1 point');
  });

  it('is null for a week with nothing to recap', () => {
    expect(recapPushBody(recap())).toBeNull();
    expect(
      recapPushBody(
        recap({
          events_attended: null,
          tasks_done: null,
          points: null,
          service_minutes: null,
          study_minutes: null,
        }),
      ),
    ).toBeNull();
  });
});

describe('ActivityRecapPushService', () => {
  // Sunday 09:30 in New York.
  const NOW = new Date('2026-11-15T14:30:00Z');
  const CHAPTER = {
    id: 'chap-1',
    name: 'Alpha Beta',
    enabled_modules: { points: true },
  };

  function build() {
    const chapterRepo = {
      findForRecapPush: jest.fn().mockResolvedValue([CHAPTER]),
    };
    const claims = {
      claim: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const rbac = {
      getChapterMemberAccess: jest.fn().mockResolvedValue([
        { user_id: 'u-member', permissions: new Set(['members:view']) },
        { user_id: 'u-president', permissions: new Set(['*']) },
        // Can't read the recap, so isn't sent it.
        { user_id: 'u-guest', permissions: new Set(['events:view']) },
      ]),
    };
    const recapService = {
      getRecap: jest.fn().mockResolvedValue(recap({ events_attended: 2 })),
    };
    const notificationService = {
      timeZonesFor: jest.fn((ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, 'America/New_York']))),
      ),
      notifyUser: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ActivityRecapPushService(
      chapterRepo as never,
      claims,
      rbac as never,
      recapService as never,
      notificationService as never,
    );
    return {
      service,
      chapterRepo,
      claims,
      rbac,
      recapService,
      notificationService,
    };
  }

  it('sends each member who can read the recap last week’s line, once, under its own switch', async () => {
    const deps = build();

    await expect(deps.service.sweep(NOW)).resolves.toBe(2);

    expect(deps.claims.claim.mock.calls).toEqual([
      ['chap-1', 'u-member', '2026-11-08'],
      ['chap-1', 'u-president', '2026-11-08'],
    ]);
    expect(deps.recapService.getRecap).toHaveBeenCalledWith(
      'chap-1',
      'u-member',
      CHAPTER.enabled_modules,
      {
        weekStart: new Date('2026-11-15T05:00:00Z'),
        lastWeekStart: new Date('2026-11-08T05:00:00Z'),
        firstDay: '2026-11-08',
        now: NOW,
      },
    );
    expect(deps.notificationService.notifyUser).toHaveBeenCalledWith(
      'u-member',
      'chap-1',
      {
        title: 'Last week in Alpha Beta',
        body: '2 events',
        category: RECAP_NOTIFICATION_CATEGORY,
        data: { target: { screen: 'activity' } },
      },
    );
    expect(RECAP_NOTIFICATION_CATEGORY).toBe('recap');
  });

  it('reads nothing outside Sunday morning anywhere', async () => {
    const deps = build();
    await expect(
      deps.service.sweep(new Date('2026-11-18T14:30:00Z')),
    ).resolves.toBe(0);
    expect(deps.chapterRepo.findForRecapPush).not.toHaveBeenCalled();
  });

  it("waits for a member whose Sunday morning hasn't come", async () => {
    const deps = build();
    deps.notificationService.timeZonesFor.mockImplementation((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, 'America/Los_Angeles']))),
    );
    await expect(deps.service.sweep(NOW)).resolves.toBe(0);
    expect(deps.claims.claim).not.toHaveBeenCalled();
  });

  it('reads no recap when another replica holds the claim', async () => {
    const deps = build();
    deps.claims.claim.mockResolvedValue(false);
    await expect(deps.service.sweep(NOW)).resolves.toBe(0);
    expect(deps.recapService.getRecap).not.toHaveBeenCalled();
    expect(deps.notificationService.notifyUser).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty week, and keeps the claim so it is not read again', async () => {
    const deps = build();
    deps.recapService.getRecap.mockResolvedValue(recap());
    await expect(deps.service.sweep(NOW)).resolves.toBe(0);
    expect(deps.notificationService.notifyUser).not.toHaveBeenCalled();
    expect(deps.claims.release).not.toHaveBeenCalled();
  });

  it('gives the claim back for a recap read in part, or a push that failed', async () => {
    const deps = build();
    deps.recapService.getRecap.mockResolvedValueOnce(
      recap({ events_attended: 2, unavailable: ['points'] }),
    );
    deps.notificationService.notifyUser.mockRejectedValueOnce(
      new Error('push down'),
    );

    await expect(deps.service.sweep(NOW)).resolves.toBe(0);

    expect(deps.notificationService.notifyUser).toHaveBeenCalledTimes(1);
    expect(deps.claims.release.mock.calls).toEqual([
      ['chap-1', 'u-member', '2026-11-08'],
      ['chap-1', 'u-president', '2026-11-08'],
    ]);
  });

  it("goes on to the next chapter when one chapter's read fails", async () => {
    const deps = build();
    deps.chapterRepo.findForRecapPush.mockResolvedValue([
      { ...CHAPTER, id: 'chap-broken' },
      CHAPTER,
    ]);
    deps.rbac.getChapterMemberAccess.mockRejectedValueOnce(new Error('down'));
    await expect(deps.service.sweep(NOW)).resolves.toBe(2);
  });
});
