import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { RbacService } from '../../application/services/rbac.service';
import { ChatBlockService } from '../../application/services/chat-block.service';
import {
  ChatPushWorkerService,
  fanOutStartTime,
  MAX_PRESENCE_CHANNELS,
} from './chat-push-worker.service';
import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import { ChatPushDispatchRepository } from './chat-push-dispatch.repository';
import { ChannelCacheService } from './channel-cache.service';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs'),
  captureMessage: jest.fn(),
  startNewTrace: jest.fn((callback: () => unknown) => callback()),
  startSpan: jest.fn(),
}));

/**
 * The presence-channel budget (#2507) and the fan-out span (ADR-09's
 * watermark), driven through `handleMessage` like every other worker case.
 *
 * Every Realtime channel a process opens shares one Supabase client, and
 * Supabase refuses a join past 100 per client. Before the cap, one presence
 * channel per chat channel stayed open for the life of the process, so the
 * refusals started at roughly 98 active chat channels, silently.
 */

interface FakeChannel {
  topic: string;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  teardown: jest.Mock;
  presenceState: () => Record<string, unknown>;
  /** The status callback the worker passed to `subscribe`. */
  status: (status: string, err?: Error) => void;
}

function fakeRealtime() {
  const opened: FakeChannel[] = [];
  const channel = jest.fn((topic: string) => {
    const ch = {
      topic,
      unsubscribe: jest.fn().mockResolvedValue('ok'),
      teardown: jest.fn(),
      presenceState: () => ({}),
      status: () => undefined,
    } as unknown as FakeChannel;
    ch.subscribe = jest.fn((callback: FakeChannel['status']) => {
      ch.status = callback;
      return ch;
    });
    opened.push(ch);
    return ch;
  });
  const topicsOpened = () => opened.map((ch) => ch.topic);
  return { channel, opened, topicsOpened };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ChatPushWorkerService — presence channels and the fan-out span', () => {
  let realtime: ReturnType<typeof fakeRealtime>;
  let claim: jest.Mock;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let worker: ChatPushWorkerService;
  let warn: jest.SpyInstance;
  let messageSeq = 0;

  const message = (channelId: string, createdAt = new Date().toISOString()) => {
    messageSeq += 1;
    return {
      id: `msg-${messageSeq}`,
      channel_id: channelId,
      sender_id: 'sender',
      content: 'hello',
      kind: 'text',
      mentions: [],
      created_at: createdAt,
    };
  };

  /** A message another instance won: presence is joined, nothing else runs. */
  const receive = (channelId: string) =>
    worker.handleMessage(message(channelId));

  beforeEach(async () => {
    realtime = fakeRealtime();
    claim = jest.fn().mockResolvedValue('taken');
    notifyUser = jest.fn().mockResolvedValue(undefined);
    findByChapter = jest.fn().mockResolvedValue([]);
    jest.mocked(Sentry.captureMessage).mockClear();
    jest.mocked(Sentry.startSpan).mockReset();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        ChannelCacheService,
        { provide: SUPABASE_CLIENT, useValue: { channel: realtime.channel } },
        {
          provide: USER_REPOSITORY,
          useValue: {
            findDisplayIdentitiesByIds: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: MEMBER_REPOSITORY, useValue: { findByChapter } },
        { provide: NotificationService, useValue: { notifyUser } },
        {
          provide: ChatNotificationPreferenceRepository,
          useValue: { findForUsers: jest.fn().mockResolvedValue(new Map()) },
        },
        { provide: ChatPushDispatchRepository, useValue: { claim } },
        {
          provide: RbacService,
          useValue: {
            getEffectivePermissions: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ChatBlockService,
          useValue: {
            filterOutBlockers: jest.fn(
              async (_chapter: string, _sender: string, ids: string[]) => ids,
            ),
          },
        },
      ],
    }).compile();
    worker = mod.get(ChatPushWorkerService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the cap', () => {
    const fill = async (count: number) => {
      for (let i = 0; i < count; i += 1) await receive(`ch-${i}`);
    };

    it('keeps one presence channel per chat channel, reused for every message', async () => {
      await receive('ch-a');
      await receive('ch-a');
      await receive('ch-b');

      expect(realtime.topicsOpened()).toEqual([
        'chat:channel:ch-a',
        'chat:channel:ch-b',
      ]);
    });

    it(`opens no more than ${MAX_PRESENCE_CHANNELS}, well under Supabase's 100 per client`, async () => {
      await fill(MAX_PRESENCE_CHANNELS + 5);

      const live = realtime.opened.filter(
        (ch) => ch.teardown.mock.calls.length === 0,
      );
      expect(live).toHaveLength(MAX_PRESENCE_CHANNELS);
      expect(MAX_PRESENCE_CHANNELS).toBeLessThanOrEqual(100 - 2);
    });

    it('evicts the channel whose last message is oldest, not the first opened', async () => {
      await fill(MAX_PRESENCE_CHANNELS);
      // ch-0 opened first but is the busiest channel: it must survive.
      await receive('ch-0');

      await receive('ch-new');
      await flush();

      const [ch0, ch1] = realtime.opened;
      expect(ch0.teardown).not.toHaveBeenCalled();
      expect(ch1.unsubscribe).toHaveBeenCalledTimes(1);
      expect(ch1.teardown).toHaveBeenCalledTimes(1);
    });

    // realtime-resilience rule 1: `removeChannel()` skips `teardown()` unless
    // the leave is acknowledged, and a registered channel hands itself back to
    // the next `supabase.channel()` on its topic.
    it('tears an evicted channel down even when its leave is not acknowledged', async () => {
      await fill(MAX_PRESENCE_CHANNELS);
      realtime.opened[0].unsubscribe.mockResolvedValue('timed out');

      await receive('ch-new');
      await flush();

      expect(realtime.opened[0].teardown).toHaveBeenCalledTimes(1);
    });

    it('does not reopen a topic while its release is still in flight, then reopens it', async () => {
      await fill(MAX_PRESENCE_CHANNELS);
      let finishLeave: (status: string) => void = () => undefined;
      realtime.opened[0].unsubscribe.mockReturnValue(
        new Promise((resolve) => {
          finishLeave = resolve;
        }),
      );

      await receive('ch-new'); // evicts ch-0
      await receive('ch-0');
      expect(realtime.topicsOpened()).toHaveLength(MAX_PRESENCE_CHANNELS + 1);

      finishLeave('ok');
      await flush();
      await receive('ch-0');

      expect(realtime.topicsOpened().at(-1)).toBe('chat:channel:ch-0');
      expect(realtime.topicsOpened()).toHaveLength(MAX_PRESENCE_CHANNELS + 2);
    });
  });

  describe('the subscribe status callback', () => {
    it('passes a status callback to every presence subscribe', async () => {
      await receive('ch-a');

      expect(realtime.opened[0].subscribe).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it.each(['CHANNEL_ERROR', 'TIMED_OUT'])(
      'logs and reports a %s join, and keeps the channel for realtime-js to retry',
      async (status) => {
        await receive('ch-a');

        realtime.opened[0].status(status, new Error('too many channels'));

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`presence join ${status} for ch-a`),
        );
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          'chat-push presence join failed',
          expect.objectContaining({
            level: 'warning',
            tags: expect.objectContaining({ realtime_status: status }),
          }),
        );
        expect(realtime.opened[0].unsubscribe).not.toHaveBeenCalled();
        await receive('ch-a');
        expect(realtime.channel).toHaveBeenCalledTimes(1);
      },
    );

    // A dropped socket fails every open channel at once.
    it('reports to Sentry once per window, however many channels fail', async () => {
      await receive('ch-a');
      await receive('ch-b');

      realtime.opened[0].status('CHANNEL_ERROR');
      realtime.opened[1].status('CHANNEL_ERROR');

      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('drops a channel the server closed, so its next message reopens it', async () => {
      await receive('ch-a');

      realtime.opened[0].status('CLOSED');
      await flush();
      await receive('ch-a');

      expect(realtime.opened[0].teardown).toHaveBeenCalledTimes(1);
      expect(realtime.topicsOpened()).toEqual([
        'chat:channel:ch-a',
        'chat:channel:ch-a',
      ]);
    });

    it('ignores the CLOSED its own eviction echoes back', async () => {
      for (let i = 0; i <= MAX_PRESENCE_CHANNELS; i += 1) {
        await receive(`ch-${i}`);
      }
      await flush();
      const evicted = realtime.opened[0];

      evicted.status('CLOSED');
      await flush();

      expect(evicted.unsubscribe).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('frees the topic when subscribe itself throws, so the next message retries', async () => {
      realtime.channel.mockImplementationOnce((topic: string) => {
        const broken = {
          topic,
          subscribe: jest.fn(() => {
            throw new Error('tried to subscribe multiple times');
          }),
          unsubscribe: jest.fn().mockResolvedValue('ok'),
          teardown: jest.fn(),
          presenceState: () => ({}),
        };
        realtime.opened.push(broken as unknown as FakeChannel);
        return broken;
      });

      await receive('ch-a');
      await flush();
      await receive('ch-a');

      expect(realtime.opened[0].teardown).toHaveBeenCalledTimes(1);
      expect(realtime.channel).toHaveBeenCalledTimes(2);
    });
  });

  describe('the fan-out span (ADR-09)', () => {
    const CHANNEL = {
      id: 'ch-general',
      chapter_id: 'chap-1',
      name: 'general',
      default_notification_level: 'all' as const,
      is_read_only: false,
      type: 'PUBLIC' as const,
      member_ids: null,
      required_permissions: null,
    };

    let spans: Array<{
      options: Record<string, unknown>;
      setAttributes: jest.Mock;
    }>;

    beforeEach(() => {
      spans = [];
      jest
        .mocked(Sentry.startSpan)
        .mockImplementation(
          (
            options: Record<string, unknown>,
            callback: (span: { setAttributes: jest.Mock }) => unknown,
          ) => {
            const span = { setAttributes: jest.fn() };
            spans.push({ options, setAttributes: span.setAttributes });
            return callback(span);
          },
        );
      claim.mockResolvedValue('claimed');
      worker.__setChannelForTest(CHANNEL);
      findByChapter.mockResolvedValue(
        ['sender', 'a', 'b', 'c'].map((user_id) => ({ user_id })),
      );
    });

    it('wraps each claimed fan-out in its own transaction, measured from the insert', async () => {
      const insertedAt = new Date(Date.now() - 1500).toISOString();

      await worker.handleMessage(message(CHANNEL.id, insertedAt));

      expect(Sentry.startNewTrace).toHaveBeenCalled();
      expect(spans).toHaveLength(1);
      expect(spans[0].options).toMatchObject({
        name: 'chat.push.fanout',
        op: 'chat.push',
        forceTransaction: true,
        startTime: new Date(insertedAt),
        attributes: { 'chat.push.presence_channels': 1 },
      });
    });

    it('records the audience and the pushes that went out, as counts only', async () => {
      notifyUser.mockImplementation(async (userId: string) => {
        if (userId === 'c') throw new Error('push provider down');
      });

      await worker.handleMessage(message(CHANNEL.id));

      expect(spans[0].setAttributes).toHaveBeenCalledWith({
        'chat.push.recipients': 3,
        'chat.push.sent': 2,
      });
    });

    it('records an empty audience rather than skipping the span', async () => {
      findByChapter.mockResolvedValue([{ user_id: 'sender' }]);

      await worker.handleMessage(message(CHANNEL.id));

      expect(spans[0].setAttributes).toHaveBeenCalledWith({
        'chat.push.recipients': 0,
        'chat.push.sent': 0,
      });
    });

    it('opens no span for a message another instance claimed', async () => {
      claim.mockResolvedValue('taken');

      await worker.handleMessage(message(CHANNEL.id));

      expect(spans).toHaveLength(0);
    });
  });
});

describe('fanOutStartTime', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');

  it('starts at the insert when it is recent', () => {
    expect(fanOutStartTime('2026-09-30T11:59:58.500Z', now)).toEqual(
      new Date('2026-09-30T11:59:58.500Z'),
    );
  });

  it.each([
    ['a clock ahead of this one', '2026-09-30T12:00:01.000Z'],
    ['a redelivery long after the insert', '2026-09-30T11:40:00.000Z'],
    ['an unreadable timestamp', 'not a date'],
  ])('starts now for %s', (_label, createdAt) => {
    expect(fanOutStartTime(createdAt, now)).toEqual(new Date(now));
  });
});
