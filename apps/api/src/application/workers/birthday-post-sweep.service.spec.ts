import {
  BirthdayPostSweepService,
  birthdayPostContent,
  dueBirthdays,
} from './birthday-post-sweep.service';
import type { UserSharedBirthday } from '#domain/entities/user.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

const dana: UserSharedBirthday = {
  id: 'u-dana',
  display_name: 'Dana Lowe',
  avatar_url: null,
  birthday_month: 3,
  birthday_day: 4,
};

describe('dueBirthdays (#4959)', () => {
  it("is due from 9 AM on the member's own day, not before", () => {
    // 13:30 UTC is 08:30 in New York (EST... March 4 is before DST).
    expect(
      dueBirthdays(
        [dana],
        () => 'America/New_York',
        new Date('2026-03-04T13:30:00Z'),
      ),
    ).toEqual([]);
    expect(
      dueBirthdays(
        [dana],
        () => 'America/New_York',
        new Date('2026-03-04T14:30:00Z'),
      ),
    ).toEqual([
      { userId: 'u-dana', name: 'Dana Lowe', localDate: '2026-03-04' },
    ]);
  });

  it("reads the day in the member's zone, not the server's", () => {
    // 2026-03-05T02:00Z is still March 4 in Los Angeles (18:00).
    const now = new Date('2026-03-05T02:00:00Z');
    expect(dueBirthdays([dana], () => 'America/Los_Angeles', now)).toHaveLength(
      1,
    );
    expect(dueBirthdays([dana], () => 'Asia/Tokyo', now)).toEqual([]);
  });

  it('falls back to New York for no zone or one that does not resolve', () => {
    const now = new Date('2026-03-04T15:00:00Z');
    expect(dueBirthdays([dana], () => null, now)).toHaveLength(1);
    expect(dueBirthdays([dana], () => 'Not/AZone', now)).toHaveLength(1);
  });

  it('posts a leap-day birthday on 28 February outside leap years', () => {
    const leap = { ...dana, birthday_month: 2, birthday_day: 29 };
    expect(
      dueBirthdays([leap], () => 'UTC', new Date('2027-02-28T12:00:00Z')),
    ).toEqual([
      { userId: 'u-dana', name: 'Dana Lowe', localDate: '2027-02-28' },
    ]);
    expect(
      dueBirthdays([leap], () => 'UTC', new Date('2028-02-28T12:00:00Z')),
    ).toEqual([]);
  });
});

describe('BirthdayPostSweepService (#4959)', () => {
  const now = new Date('2026-03-04T15:00:00Z');

  type Setup = {
    channel?: Record<string, unknown> | null;
    subscription_status?: string;
    past_due_since?: string | null;
    claimed?: boolean;
    insertFails?: boolean;
    settings?: Record<string, unknown>[];
  };

  function setup(overrides: Setup = {}) {
    const chapterRepo = {
      findWithBirthdayChannel: jest.fn().mockResolvedValue([
        {
          id: 'ch-1',
          birthday_channel_id: 'chan-1',
          subscription_status: overrides.subscription_status ?? 'active',
          past_due_since: overrides.past_due_since ?? null,
        },
      ]),
    };
    const channelRepo = {
      findById: jest.fn().mockResolvedValue(
        overrides.channel === undefined
          ? {
              id: 'chan-1',
              type: 'PUBLIC',
              archived_at: null,
              is_audit_log: false,
            }
          : overrides.channel,
      ),
    };
    const messageRepo = {
      insertIdempotent: overrides.insertFails
        ? jest.fn().mockRejectedValue(new Error('insert failed'))
        : jest.fn().mockResolvedValue('inserted'),
    };
    const memberRepo = {
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ user_id: 'u-dana' }, { user_id: 'u-other' }]),
    };
    const userRepo = {
      findSharedBirthdaysByIds: jest.fn().mockResolvedValue([dana]),
    };
    const settingsRepo = {
      findByUserIds: jest
        .fn()
        .mockResolvedValue(
          overrides.settings ?? [
            { user_id: 'u-dana', time_zone: 'America/New_York' },
          ],
        ),
    };
    const claims = {
      claim: jest.fn().mockResolvedValue(overrides.claimed ?? true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BirthdayPostSweepService(
      chapterRepo as never,
      channelRepo as never,
      messageRepo as never,
      memberRepo as never,
      userRepo as never,
      settingsRepo as never,
      claims,
    );
    return { service, channelRepo, messageRepo, userRepo, claims };
  }

  it('claims the day for the chapter, then posts once as Frapp', async () => {
    const { service, channelRepo, messageRepo, userRepo, claims } = setup();

    await expect(service.sweep(now)).resolves.toBe(1);

    expect(channelRepo.findById).toHaveBeenCalledWith('chan-1', 'ch-1');
    expect(userRepo.findSharedBirthdaysByIds).toHaveBeenCalledWith([
      'u-dana',
      'u-other',
    ]);
    expect(claims.claim).toHaveBeenCalledWith('ch-1', 'u-dana', '2026-03-04');
    expect(messageRepo.insertIdempotent).toHaveBeenCalledWith({
      channel_id: 'chan-1',
      sender_id: SYSTEM_SENDER_ID,
      content: birthdayPostContent('Dana Lowe'),
      kind: 'text',
      client_message_id: 'birthday:u-dana:2026-03-04',
    });
  });

  it('posts nothing once the day is claimed, whatever channel is set now', async () => {
    // Another replica's tick, or a post in the channel before the officer
    // switched it, already claimed Dana's day for this chapter.
    const { service, messageRepo } = setup({ claimed: false });

    await expect(service.sweep(now)).resolves.toBe(0);
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it('gives the claim back when the post fails, so the next tick retries', async () => {
    const { service, claims } = setup({ insertFails: true });

    await expect(service.sweep(now)).resolves.toBe(0);
    expect(claims.release).toHaveBeenCalledWith('ch-1', 'u-dana', '2026-03-04');
  });

  it.each([
    [
      'archived',
      { type: 'PUBLIC', archived_at: '2026-01-01', is_audit_log: false },
    ],
    [
      'made private',
      { type: 'PRIVATE', archived_at: null, is_audit_log: false },
    ],
    [
      'the audit feed',
      { type: 'PUBLIC', archived_at: null, is_audit_log: true },
    ],
    ['gone', null],
  ])('posts nothing into a channel that is %s', async (_label, channel) => {
    const { service, claims, messageRepo } = setup({
      channel: channel === null ? null : { id: 'chan-1', ...channel },
    });

    await expect(service.sweep(now)).resolves.toBe(0);
    expect(claims.claim).not.toHaveBeenCalled();
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it('posts nothing in a chapter that is read-only for billing', async () => {
    const { service, channelRepo, claims } = setup({
      subscription_status: 'canceled',
    });

    await expect(service.sweep(now)).resolves.toBe(0);
    expect(channelRepo.findById).not.toHaveBeenCalled();
    expect(claims.claim).not.toHaveBeenCalled();
  });

  it("reads the member's zone the way a push does: quiet hours when no device zone", async () => {
    // 2026-03-05T02:00Z is still March 4, 6 PM in Los Angeles, but already
    // March 5 in New York's fallback.
    const { service, claims } = setup({
      settings: [
        {
          user_id: 'u-dana',
          time_zone: null,
          quiet_hours_tz: 'America/Los_Angeles',
        },
      ],
    });

    await expect(service.sweep(new Date('2026-03-05T02:00:00Z'))).resolves.toBe(
      1,
    );
    expect(claims.claim).toHaveBeenCalledWith('ch-1', 'u-dana', '2026-03-04');
  });
});
