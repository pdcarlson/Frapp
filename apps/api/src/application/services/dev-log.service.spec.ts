import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  DEV_LOG_ENV,
  DevLogService,
  devLogClientMessageId,
  formatDevLogPost,
  hashDevLogToken,
  resolveDevLogConfig,
  validateDevLogEnv,
} from './dev-log.service';

const TOKEN = 'a'.repeat(64);
const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const ENV = {
  [DEV_LOG_ENV.tokenHash]: hashDevLogToken(TOKEN),
  [DEV_LOG_ENV.chapterId]: CHAPTER_ID,
  [DEV_LOG_ENV.channelId]: CHANNEL_ID,
};
const NOTE = {
  date: '2026-11-10',
  title: 'Threads',
  changes: ['Reply in a thread.', 'Set your status.'],
};

describe('validateDevLogEnv', () => {
  it('accepts all three unset (the Dev log is off)', () => {
    expect(validateDevLogEnv({})).toEqual([]);
    expect(resolveDevLogConfig({})).toBeNull();
  });

  it('accepts a full, well-formed trio', () => {
    expect(validateDevLogEnv(ENV)).toEqual([]);
    expect(resolveDevLogConfig(ENV)).toEqual({
      tokenHash: hashDevLogToken(TOKEN),
      chapterId: CHAPTER_ID,
      channelId: CHANNEL_ID,
    });
  });

  it('refuses a half-set trio rather than reading it as off', () => {
    const problems = validateDevLogEnv({
      [DEV_LOG_ENV.tokenHash]: hashDevLogToken(TOKEN),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('must be set together');
  });

  it('refuses the token itself where its hash belongs', () => {
    const problems = validateDevLogEnv({
      ...ENV,
      [DEV_LOG_ENV.tokenHash]: 'not-a-digest',
    });
    expect(problems.join(' ')).toContain('never the token itself');
  });

  it('refuses a channel or chapter id that is not a uuid', () => {
    const problems = validateDevLogEnv({
      ...ENV,
      [DEV_LOG_ENV.channelId]: 'dev-log',
    });
    expect(problems).toEqual([`${DEV_LOG_ENV.channelId} must be a uuid.`]);
  });
});

describe('formatDevLogPost', () => {
  it('says who started what, in which area, and who is already there', () => {
    expect(
      formatDevLogPost({
        event: 'work_started',
        number: 12,
        title: 'Activity page:\n sign-up links',
        actor: 'Shawn',
        areas: ['chat', 'web'],
        also_in_area: [
          {
            number: 9,
            title: 'Chat threads',
            actor: 'Winston',
            areas: ['chat'],
          },
        ],
      }),
    ).toBe(
      [
        'Shawn started: Activity page: sign-up links (#12)',
        'Area: chat, web',
        'https://github.com/pdcarlson/Frapp/issues/12',
        '',
        'Also in progress in that area:',
        '• Chat threads (#9) · Winston · chat',
        '  https://github.com/pdcarlson/Frapp/issues/9',
      ].join('\n'),
    );
  });

  it('leaves the area lines out when the issue has none', () => {
    expect(
      formatDevLogPost({
        event: 'work_started',
        number: 12,
        title: 'T',
        actor: 'Paul',
      }),
    ).toBe(
      'Paul started: T (#12)\nhttps://github.com/pdcarlson/Frapp/issues/12',
    );
  });

  it('links a merged pull request by its number', () => {
    expect(
      formatDevLogPost({
        event: 'pr_merged',
        number: 40,
        title: 'Fix the badge',
        actor: 'Evan',
      }),
    ).toBe(
      'Merged: Fix the badge (#40) by Evan\nhttps://github.com/pdcarlson/Frapp/pull/40',
    );
  });

  it('lists the day, and says so when a section is empty', () => {
    const text = formatDevLogPost({
      event: 'daily_summary',
      date: '2026-11-11',
      merged: [{ number: 40, title: 'Fix the badge', actor: 'Evan' }],
    });
    expect(text).toContain('Dev log summary for 2026-11-11');
    expect(text).toContain('Merged in the last day (1):');
    expect(text).toContain(
      '• Fix the badge (#40) · Evan\n  https://github.com/pdcarlson/Frapp/pull/40',
    );
    expect(text).toContain('In progress now (0):\n• Nothing in progress.');
  });

  it("carries the deployment's newest What's new entry on an update post", () => {
    expect(
      formatDevLogPost(
        {
          event: 'update_pushed',
          run_id: 35722904165,
          store_build: true,
          ota_update: true,
        },
        NOTE,
      ),
    ).toBe(
      [
        'Update pushed: please update.',
        '• Web: live now. Refresh the page to get it.',
        '• Phone app: a new build was uploaded for testers. Install it once TestFlight or Google Play offers it.',
        '• Phone app: an update is out. Close the app fully and open it again to get it.',
        '',
        "What's new (2026-11-10): Threads",
        '• Reply in a thread.',
        '• Set your status.',
      ].join('\n'),
    );
  });

  it('names only the web when the run shipped nothing for the phone', () => {
    const text = formatDevLogPost({ event: 'update_pushed', run_id: 1 }, NOTE);
    expect(text).not.toContain('Phone app');
    expect(text).toContain("What's new (2026-11-10): Threads");
  });

  it('never exceeds the chat length cap', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      number: i + 1,
      title: 'x'.repeat(300),
    }));
    const text = formatDevLogPost({
      event: 'daily_summary',
      date: '2026-11-11',
      merged: items,
      in_progress: items,
    });
    expect(text.length).toBeLessThanOrEqual(10_000);
    expect(text.endsWith('(cut short)')).toBe(true);
  });
});

describe('devLogClientMessageId', () => {
  it('keys each event on what makes it the same event', () => {
    expect(
      devLogClientMessageId({
        event: 'work_started',
        number: 7,
        title: 'T',
        actor: 'A',
      }),
    ).toBe('devlog:work_started:7');
    expect(
      devLogClientMessageId({ event: 'daily_summary', date: '2026-11-11' }),
    ).toBe('devlog:daily_summary:2026-11-11');
    expect(
      devLogClientMessageId({ event: 'update_pushed', run_id: 35722904165 }),
    ).toBe('devlog:update_pushed:35722904165');
  });
});

describe('DevLogService', () => {
  const saved = { ...process.env };
  let channelRepo: { findById: jest.Mock };
  let messageRepo: { insertIdempotent: jest.Mock };
  let service: DevLogService;

  beforeEach(() => {
    Object.assign(process.env, ENV);
    channelRepo = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: CHANNEL_ID, archived_at: null }),
    };
    messageRepo = { insertIdempotent: jest.fn().mockResolvedValue('inserted') };
    service = new DevLogService(
      channelRepo as unknown as IChatChannelRepository,
      messageRepo as unknown as IChatMessageRepository,
    );
  });

  afterEach(() => {
    for (const name of Object.values(DEV_LOG_ENV)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  describe('assertToken', () => {
    it('accepts the token whose hash is configured', () => {
      expect(() => service.assertToken(TOKEN)).not.toThrow();
    });

    it('refuses a wrong token, a missing one, and the hash itself', () => {
      expect(() => service.assertToken('b'.repeat(64))).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertToken(undefined)).toThrow(
        UnauthorizedException,
      );
      // The stored value is not a credential: leaking it grants nothing.
      expect(() => service.assertToken(hashDevLogToken(TOKEN))).toThrow(
        UnauthorizedException,
      );
    });

    it('answers 404 while the Dev log is off, even for the right token', () => {
      delete process.env[DEV_LOG_ENV.tokenHash];
      expect(() => service.assertToken(TOKEN)).toThrow(NotFoundException);
    });
  });

  describe('post', () => {
    const post = {
      event: 'pr_merged',
      number: 40,
      title: 'Fix the badge',
      actor: 'Evan',
    } as const;

    it('writes one text row from Frapp into the configured channel only', async () => {
      await expect(service.post(post)).resolves.toBe('posted');
      // The channel is looked up inside the configured chapter: a channel id
      // from another chapter finds nothing.
      expect(channelRepo.findById).toHaveBeenCalledWith(CHANNEL_ID, CHAPTER_ID);
      expect(messageRepo.insertIdempotent).toHaveBeenCalledWith({
        channel_id: CHANNEL_ID,
        sender_id: SYSTEM_SENDER_ID,
        content:
          'Merged: Fix the badge (#40) by Evan\nhttps://github.com/pdcarlson/Frapp/pull/40',
        kind: 'text',
        client_message_id: 'devlog:pr_merged:40',
      });
    });

    it('reports a repeat of the same event as a duplicate', async () => {
      messageRepo.insertIdempotent.mockResolvedValue('duplicate');
      await expect(service.post(post)).resolves.toBe('duplicate');
    });

    it('refuses to post when the channel is gone or archived', async () => {
      channelRepo.findById.mockResolvedValue(null);
      await expect(service.post(post)).rejects.toThrow(NotFoundException);
      channelRepo.findById.mockResolvedValue({
        id: CHANNEL_ID,
        archived_at: '2026-11-11T00:00:00Z',
      });
      await expect(service.post(post)).rejects.toThrow(NotFoundException);
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it('refuses to post while the Dev log is off', async () => {
      delete process.env[DEV_LOG_ENV.channelId];
      await expect(service.post(post)).rejects.toThrow(NotFoundException);
      expect(channelRepo.findById).not.toHaveBeenCalled();
    });
  });
});
