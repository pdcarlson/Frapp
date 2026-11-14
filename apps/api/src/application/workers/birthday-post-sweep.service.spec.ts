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

  function setup(overrides: { archived?: boolean; inserted?: boolean } = {}) {
    const chapterRepo = {
      findWithBirthdayChannel: jest
        .fn()
        .mockResolvedValue([{ id: 'ch-1', birthday_channel_id: 'chan-1' }]),
    };
    const channelRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'chan-1',
        type: 'PUBLIC',
        archived_at: overrides.archived ? '2026-01-01T00:00:00Z' : null,
      }),
    };
    const messageRepo = {
      insertIdempotent: jest
        .fn()
        .mockResolvedValue(
          overrides.inserted === false ? 'duplicate' : 'inserted',
        ),
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
        .mockResolvedValue([
          { user_id: 'u-dana', time_zone: 'America/New_York' },
        ]),
    };
    const service = new BirthdayPostSweepService(
      chapterRepo as never,
      channelRepo as never,
      messageRepo as never,
      memberRepo as never,
      userRepo as never,
      settingsRepo as never,
    );
    return { service, channelRepo, messageRepo, userRepo };
  }

  it('posts once per member and day as Frapp, keyed so replicas collide', async () => {
    const { service, channelRepo, messageRepo, userRepo } = setup();

    await expect(service.sweep(now)).resolves.toBe(1);

    expect(channelRepo.findById).toHaveBeenCalledWith('chan-1', 'ch-1');
    expect(userRepo.findSharedBirthdaysByIds).toHaveBeenCalledWith([
      'u-dana',
      'u-other',
    ]);
    expect(messageRepo.insertIdempotent).toHaveBeenCalledWith({
      channel_id: 'chan-1',
      sender_id: SYSTEM_SENDER_ID,
      content: birthdayPostContent('Dana Lowe'),
      kind: 'text',
      client_message_id: 'birthday:u-dana:2026-03-04',
    });
  });

  it('counts nothing when another replica already posted', async () => {
    const { service } = setup({ inserted: false });

    await expect(service.sweep(now)).resolves.toBe(0);
  });

  it('posts nothing into an archived channel', async () => {
    const { service, messageRepo } = setup({ archived: true });

    await expect(service.sweep(now)).resolves.toBe(0);
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });
});
