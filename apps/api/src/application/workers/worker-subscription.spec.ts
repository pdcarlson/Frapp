import type { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import {
  fakeChannel,
  fakeRealtime,
  type FakeChannel,
} from '#test/helpers/fake-realtime';
import {
  reopenDelayMs,
  WORKER_REOPEN_MAX_DELAY_MS,
  WORKER_SUBSCRIPTION_DOWN_AFTER_MS,
  WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS,
  WORKER_SUBSCRIPTION_UNSTABLE_DROPS,
  WORKER_SUBSCRIPTION_UNSTABLE_WINDOW_MS,
  WorkerSubscription,
} from './worker-subscription';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs'),
  captureMessage: jest.fn(),
}));

/**
 * The long-lived workers' Realtime subscription (#3365), driven through the
 * status callback realtime-js would call.
 *
 * The case that matters most is `CLOSED`: realtime-js never rejoins a channel
 * the server closed, so before this the chat-push and chat-bridge workers
 * stopped there until the next deploy. `CHANNEL_ERROR` and `TIMED_OUT` are the
 * other half: realtime-js does rejoin those, so the subscription must keep the
 * channel and not race it with a second join.
 */

const TOPIC = 'test-worker:things';

describe('WorkerSubscription', () => {
  let realtime: ReturnType<typeof fakeRealtime>;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let rows: unknown[];
  let sub: WorkerSubscription;

  const captured = () => jest.mocked(Sentry.captureMessage).mock.calls;
  const levelOf = (context: unknown) =>
    (context as { level?: string } | undefined)?.level;
  const channels = () => realtime.onTopic(TOPIC);
  const latest = (): FakeChannel => {
    const all = channels();
    return all[all.length - 1];
  };
  /** Let a release's awaits settle without moving the clock. */
  const settle = () => jest.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(Sentry.captureMessage).mockClear();
    realtime = fakeRealtime();
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    rows = [];
    sub = new WorkerSubscription(
      {
        channel: realtime.channel,
        removeChannel: realtime.removeChannel,
      } as unknown as FrappSupabaseClient,
      {
        topic: TOPIC,
        worker: 'test-worker',
        impact: 'test rows',
        logger: logger as unknown as Logger,
        bind: (channel) =>
          channel.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'things' },
            (payload: RealtimePostgresInsertPayload<{ id: string }>) => {
              rows.push(payload.new);
            },
          ),
      },
    );
  });

  afterEach(async () => {
    await sub.stop();
    jest.useRealTimers();
  });

  describe('opening', () => {
    it('opens its topic with its listeners, then subscribes', () => {
      sub.start();

      expect(realtime.channel).toHaveBeenCalledWith(TOPIC);
      expect(latest().subscribe).toHaveBeenCalledWith(expect.any(Function));
      expect(latest().insert('things', { id: 'r1' })).toBe(1);
      expect(rows).toEqual([{ id: 'r1' }]);
    });

    it('opens once however many times it is started', () => {
      sub.start();
      sub.start();

      expect(channels()).toHaveLength(1);
    });

    it('logs the subscribe and reports nothing', () => {
      sub.start();
      latest().status('SUBSCRIBED');

      expect(logger.log).toHaveBeenCalledWith(
        `test-worker subscribed to ${TOPIC}`,
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(captured()).toHaveLength(0);
    });
  });

  describe('a channel the server closed', () => {
    it('frees the topic and reopens it on a fresh channel with its listeners', async () => {
      sub.start();
      const first = latest();
      first.status('SUBSCRIBED');

      first.status('CLOSED');
      await settle();

      expect(first.unsubscribe).toHaveBeenCalledTimes(1);
      expect(first.teardown).toHaveBeenCalledTimes(1);
      expect(channels()).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

      expect(channels()).toHaveLength(2);
      const second = latest();
      expect(second).not.toBe(first);
      expect(second.subscribe).toHaveBeenCalledWith(expect.any(Function));
      // The old channel's listeners went with its teardown; rows reach the
      // worker again only because the reopen registered new ones.
      expect(first.insert('things', { id: 'old' })).toBe(0);
      expect(second.insert('things', { id: 'new' })).toBe(1);
      expect(rows).toEqual([{ id: 'new' }]);
    });

    it('does not reopen until the old channel has left, so the two never meet', async () => {
      sub.start();
      const first = latest();
      let finishLeave: (status: string) => void = () => undefined;
      first.unsubscribe.mockReturnValue(
        new Promise((resolve) => {
          finishLeave = resolve;
        }),
      );

      first.status('CLOSED');
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);
      expect(channels()).toHaveLength(1);

      finishLeave('ok');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

      expect(channels()).toHaveLength(2);
      expect(first.teardown.mock.invocationCallOrder[0]).toBeLessThan(
        realtime.channel.mock.invocationCallOrder[1],
      );
    });

    // realtime-resilience rule 1: a channel left registered is handed back by
    // the next `channel()` on its topic.
    it.each([
      ['is not acknowledged', () => Promise.resolve('timed out')],
      ['rejects', () => Promise.reject(new Error('socket down'))],
    ])(
      'tears the old channel down even when its leave %s',
      async (_, leave) => {
        sub.start();
        const first = latest();
        first.unsubscribe.mockImplementation(leave);

        first.status('CLOSED');
        await settle();
        await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

        expect(first.teardown).toHaveBeenCalledTimes(1);
        expect(channels()).toHaveLength(2);
      },
    );

    it('backs off by doubling while reopens keep closing, up to the cap', async () => {
      sub.start();
      const waited: number[] = [];
      for (let reopen = 0; reopen < 9; reopen += 1) {
        const before = channels().length;
        latest().status('CLOSED');
        await settle();
        const delay = reopenDelayMs(reopen);
        await jest.advanceTimersByTimeAsync(delay - 1);
        expect(channels()).toHaveLength(before);
        await jest.advanceTimersByTimeAsync(1);
        expect(channels()).toHaveLength(before + 1);
        waited.push(delay);
      }

      expect(waited).toEqual([
        1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
      ]);
      expect(reopenDelayMs(10_000)).toBe(WORKER_REOPEN_MAX_DELAY_MS);
    });

    it('starts the backoff over once a reopen subscribes', async () => {
      sub.start();
      latest().status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));
      latest().status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(1));
      latest().status('SUBSCRIBED');

      latest().status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

      expect(channels()).toHaveLength(4);
      expect(logger.log).toHaveBeenCalledWith(
        `test-worker subscribed to ${TOPIC} again, after 2 failed in a row`,
      );
    });

    it('ignores the CLOSED its own leave echoes back, reopening once', async () => {
      sub.start();
      const first = latest();
      first.unsubscribe.mockImplementation(async () => {
        // realtime-js fires the close callbacks again on the leave.
        first.status('CLOSED');
        return 'ok';
      });

      first.status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

      expect(channels()).toHaveLength(2);
      expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('ignores a late status from a channel it already replaced', async () => {
      sub.start();
      const first = latest();
      first.status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));
      logger.warn.mockClear();

      first.status('CHANNEL_ERROR');
      first.status('CLOSED');
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

      expect(channels()).toHaveLength(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('says the worker reopens it, and that inserts meanwhile are lost', async () => {
      sub.start();
      latest().status('CLOSED');
      await settle();

      expect(logger.warn).toHaveBeenCalledWith(
        `test-worker: ${TOPIC} CLOSED; test rows stop until this worker reopens it, and inserts meanwhile are not replayed (1 failed in a row)`,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        `test-worker: reopening ${TOPIC} in 1000 ms`,
      );
    });
  });

  describe.each(['CHANNEL_ERROR', 'TIMED_OUT'])(
    'a %s, which realtime-js rejoins itself',
    (status) => {
      it('keeps the channel and opens no second one', async () => {
        sub.start();
        const first = latest();

        first.status(status, new Error('join refused'));
        await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

        expect(first.unsubscribe).not.toHaveBeenCalled();
        expect(first.teardown).not.toHaveBeenCalled();
        expect(channels()).toHaveLength(1);
        expect(first.insert('things', { id: 'r1' })).toBe(1);
      });

      it('logs it with the error, and reports nothing', () => {
        sub.start();

        latest().status(status, new Error('socket closed: 1006'));

        expect(logger.warn).toHaveBeenCalledWith(
          `test-worker: ${TOPIC} ${status} (socket closed: 1006); test rows stop until realtime-js rejoins it, and inserts meanwhile are not replayed (1 failed in a row)`,
        );
        expect(captured()).toHaveLength(0);
      });
    },
  );

  describe('reporting', () => {
    // #3906: each one-second socket blip used to send a warning per worker.
    it('reports nothing for a drop that recovers', async () => {
      sub.start();
      const ch = latest();
      ch.status('SUBSCRIBED');

      ch.status('CHANNEL_ERROR');
      await jest.advanceTimersByTimeAsync(1000);
      ch.status('SUBSCRIBED');
      await jest.advanceTimersByTimeAsync(
        WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS,
      );

      expect(captured()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('reports nothing for a CLOSED that reopens', async () => {
      sub.start();
      latest().status('SUBSCRIBED');

      latest().status('CLOSED');
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));
      latest().status('SUBSCRIBED');

      expect(captured()).toHaveLength(0);
    });

    describe('a subscription that keeps dropping', () => {
      const UNSTABLE = [
        'test-worker realtime subscription keeps dropping; test rows are lost each time',
        {
          level: 'warning',
          tags: {
            worker: 'test-worker',
            realtime_status: 'CHANNEL_ERROR',
            drops: String(WORKER_SUBSCRIPTION_UNSTABLE_DROPS),
          },
          fingerprint: ['worker-subscription-unstable', 'test-worker'],
        },
      ];
      /** One drop that recovers a second later, then `gapMs` of quiet. */
      const blip = async (ch: FakeChannel, gapMs: number) => {
        ch.status('CHANNEL_ERROR');
        await jest.advanceTimersByTimeAsync(1000);
        ch.status('SUBSCRIBED');
        await jest.advanceTimersByTimeAsync(gapMs);
      };

      // Literals on purpose: `render.md` § 5.5 states these two numbers, and a
      // test written in terms of the constants would follow them anywhere.
      it('means three drops inside 30 minutes', async () => {
        expect(WORKER_SUBSCRIPTION_UNSTABLE_DROPS).toBe(3);
        expect(WORKER_SUBSCRIPTION_UNSTABLE_WINDOW_MS).toBe(30 * 60 * 1000);
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        await blip(ch, 14 * 60 * 1000);
        await blip(ch, 14 * 60 * 1000);
        expect(captured()).toHaveLength(0);
        await blip(ch, 0);

        expect(captured()).toEqual([UNSTABLE]);
      });

      it(`is reported as a warning on drop ${WORKER_SUBSCRIPTION_UNSTABLE_DROPS} inside one window`, async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        for (let n = 1; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS; n += 1) {
          await blip(ch, 60_000);
        }
        expect(captured()).toHaveLength(0);
        await blip(ch, 0);

        expect(captured()).toEqual([UNSTABLE]);
      });

      it('is reported for a CLOSED loop whose reopens each subscribe', async () => {
        sub.start();
        latest().status('SUBSCRIBED');

        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS; n += 1) {
          latest().status('CLOSED');
          await settle();
          await jest.advanceTimersByTimeAsync(reopenDelayMs(0));
          latest().status('SUBSCRIBED');
        }

        expect(captured()).toEqual([
          [
            UNSTABLE[0],
            expect.objectContaining({
              tags: expect.objectContaining({ realtime_status: 'CLOSED' }),
            }),
          ],
        ]);
      });

      it('is not reported for drops spread wider than the window', async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS * 2; n += 1) {
          await blip(
            ch,
            WORKER_SUBSCRIPTION_UNSTABLE_WINDOW_MS /
              (WORKER_SUBSCRIPTION_UNSTABLE_DROPS - 1),
          );
        }

        expect(captured()).toHaveLength(0);
      });

      it('counts drops, not the failed statuses of one spell down', async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS * 2; n += 1) {
          ch.status('TIMED_OUT');
        }

        expect(captured()).toHaveLength(0);
      });

      // An outage is not a subscription that keeps dropping: these reach
      // Sentry through the outage report, and only that.
      it('does not count a channel that never subscribed, whatever fails', async () => {
        realtime.channel.mockImplementationOnce(() => {
          throw new Error('no socket');
        });
        sub.start();
        await settle();

        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS * 2; n += 1) {
          await jest.advanceTimersByTimeAsync(reopenDelayMs(n));
          latest().status('CLOSED');
          await settle();
        }

        expect(logger.warn.mock.calls.length).toBeGreaterThan(
          WORKER_SUBSCRIPTION_UNSTABLE_DROPS,
        );
        expect(
          captured().filter(([, context]) => levelOf(context) === 'warning'),
        ).toHaveLength(0);
      });

      it('is reported at most once per window', async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS * 3; n += 1) {
          await blip(ch, 10_000);
        }
        expect(captured()).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_UNSTABLE_WINDOW_MS,
        );
        for (let n = 0; n < WORKER_SUBSCRIPTION_UNSTABLE_DROPS; n += 1) {
          await blip(ch, 10_000);
        }

        expect(captured()).toHaveLength(2);
      });
    });

    describe('an outage', () => {
      const errors = () =>
        captured().filter(([, context]) => levelOf(context) === 'error');
      const OUTAGE = [
        'test-worker realtime subscription is down; test rows are not being sent',
        {
          level: 'error',
          tags: {
            worker: 'test-worker',
            realtime_status: 'CHANNEL_ERROR',
            failures: '1',
          },
          fingerprint: ['worker-subscription-down', 'test-worker'],
        },
      ];

      // The shape a socket outage takes: phoenix errors a joined channel once
      // and then waits for the socket (realtime-js-contract.spec.ts), so no
      // count of failures would ever be reached.
      it(`is reported at error level after ${WORKER_SUBSCRIPTION_DOWN_AFTER_MS} ms without SUBSCRIBED, from one CHANNEL_ERROR`, async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');
        ch.status('CHANNEL_ERROR');

        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_DOWN_AFTER_MS - 1,
        );
        expect(errors()).toHaveLength(0);
        await jest.advanceTimersByTimeAsync(1);

        expect(errors()).toEqual([OUTAGE]);
        expect(logger.error).toHaveBeenCalledWith(
          `test-worker: ${TOPIC} has not been subscribed for 60 s (last status CHANNEL_ERROR, 1 failed); test rows are not being sent`,
        );
      });

      it('is reported when the subscription never subscribes after boot', async () => {
        sub.start();

        await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);

        expect(errors()).toEqual([
          [
            OUTAGE[0],
            expect.objectContaining({
              tags: {
                worker: 'test-worker',
                realtime_status: 'NONE',
                failures: '0',
              },
            }),
          ],
        ]);
      });

      it('is reported for a CLOSED reopen loop', async () => {
        sub.start();
        latest().status('SUBSCRIBED');
        for (
          let reopen = 0;
          errors().length === 0 && reopen < 10;
          reopen += 1
        ) {
          latest().status('CLOSED');
          await settle();
          await jest.advanceTimersByTimeAsync(reopenDelayMs(reopen));
        }

        expect(errors()).toEqual([
          [
            OUTAGE[0],
            expect.objectContaining({
              tags: expect.objectContaining({ realtime_status: 'CLOSED' }),
            }),
          ],
        ]);
        // Closes at 0, 1, 3, 7, 15 and 31 s. The clock runs from the first of
        // them, not the latest, or the log would say 29 s.
        expect(logger.error).toHaveBeenCalledWith(
          `test-worker: ${TOPIC} has not been subscribed for 60 s (last status CLOSED, 6 failed); test rows are not being sent`,
        );
      });

      it('is not reported for a blip that rejoins inside the window', async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');

        ch.status('CHANNEL_ERROR');
        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_DOWN_AFTER_MS / 2,
        );
        ch.status('SUBSCRIBED');
        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS,
        );

        expect(errors()).toHaveLength(0);
      });

      it('is reported again once per window while it lasts', async () => {
        sub.start();
        latest().status('TIMED_OUT');

        await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);
        expect(errors()).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS - 1,
        );
        expect(errors()).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(1);

        expect(errors()).toHaveLength(2);
      });

      it('that starts soon after another recovered is reported on its own clock', async () => {
        sub.start();
        const ch = latest();
        ch.status('SUBSCRIBED');
        ch.status('CHANNEL_ERROR');
        await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);
        expect(errors()).toHaveLength(1);
        ch.status('SUBSCRIBED');

        await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
        ch.status('CHANNEL_ERROR');
        await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);

        expect(errors()).toHaveLength(2);
      });

      it('is not reported after the subscription stops', async () => {
        sub.start();
        latest().status('CHANNEL_ERROR');

        await sub.stop();
        await jest.advanceTimersByTimeAsync(
          WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS,
        );

        expect(errors()).toHaveLength(0);
      });
    });

    it('keeps working when Sentry itself throws', async () => {
      jest.mocked(Sentry.captureMessage).mockImplementationOnce(() => {
        throw new Error('sentry unreachable');
      });
      sub.start();

      await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sentry unreachable'),
      );

      expect(() => latest().status('CLOSED')).not.toThrow();
      await settle();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));
      expect(channels()).toHaveLength(2);
    });
  });

  describe('a channel that fails to open', () => {
    it('frees what it was handed and retries with the same backoff', async () => {
      // `.on()` throws on a channel that is already subscribed: a leftover
      // still registered on the topic, which `channel()` handed back.
      realtime.channel.mockImplementationOnce((topic: string) => {
        const leftover = fakeChannel(topic);
        leftover.subscribe();
        realtime.opened.push(leftover);
        return leftover;
      });

      sub.start();
      const leftover = latest();
      await settle();

      expect(logger.error.mock.calls[0][0]).toContain(
        `test-worker: failed to open ${TOPIC}; test rows stop until it opens`,
      );
      expect(leftover.unsubscribe).toHaveBeenCalledTimes(1);
      expect(leftover.teardown).toHaveBeenCalledTimes(1);
      // Reported only if it keeps failing ("counts toward an outage" below).
      expect(captured()).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

      expect(channels()).toHaveLength(2);
      expect(latest().insert('things', { id: 'r1' })).toBe(1);
    });

    it('retries when there was no channel to free', async () => {
      realtime.channel.mockImplementationOnce(() => {
        throw new Error('client gone');
      });

      sub.start();
      await jest.advanceTimersByTimeAsync(reopenDelayMs(0));

      expect(realtime.channel).toHaveBeenCalledTimes(2);
      expect(channels()).toHaveLength(1);
    });

    it('counts toward an outage when it keeps failing', async () => {
      realtime.channel.mockImplementation(() => {
        throw new Error('client gone');
      });

      sub.start();
      await jest.advanceTimersByTimeAsync(WORKER_SUBSCRIPTION_DOWN_AFTER_MS);

      const errors = captured().filter(
        ([, context]) => levelOf(context) === 'error',
      );
      expect(errors).toEqual([
        [
          expect.any(String),
          expect.objectContaining({
            tags: expect.objectContaining({ realtime_status: 'OPEN_FAILED' }),
          }),
        ],
      ]);
    });
  });

  describe('stopping', () => {
    it('removes the channel without reading its own leave as a server close', async () => {
      sub.start();
      const ch = latest();
      ch.status('SUBSCRIBED');

      await sub.stop();
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

      expect(realtime.removeChannel).toHaveBeenCalledWith(ch);
      expect(channels()).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(captured()).toHaveLength(0);
    });

    it('cancels a reopen that was waiting', async () => {
      sub.start();
      latest().status('CLOSED');
      await settle();

      await sub.stop();
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

      expect(channels()).toHaveLength(1);
    });

    it('does not reopen when it stops while a release is in flight', async () => {
      sub.start();
      const first = latest();
      let finishLeave: (status: string) => void = () => undefined;
      first.unsubscribe.mockReturnValue(
        new Promise((resolve) => {
          finishLeave = resolve;
        }),
      );
      first.status('CLOSED');

      await sub.stop();
      finishLeave('ok');
      await jest.advanceTimersByTimeAsync(WORKER_REOPEN_MAX_DELAY_MS * 2);

      expect(first.teardown).toHaveBeenCalledTimes(1);
      expect(channels()).toHaveLength(1);
    });

    it('logs a removal that throws, and does not throw itself', async () => {
      sub.start();
      realtime.removeChannel.mockRejectedValueOnce(new Error('socket gone'));

      await expect(sub.stop()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`error removing ${TOPIC} on shutdown`),
      );
    });
  });
});
