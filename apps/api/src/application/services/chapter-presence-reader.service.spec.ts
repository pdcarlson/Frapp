import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAPTER_PRESENCE_READ_TIMEOUT_MS,
  MAX_CONCURRENT_CHAPTER_READS,
  CHAPTER_PRESENCE_SYNC_GRACE_MS,
  ChapterPresenceReader,
  presenceUserIds,
} from './chapter-presence-reader.service';

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR';

/**
 * A Realtime channel that acknowledges the join with `status`, and sends the
 * roster `state` when `sync` is true.
 */
function fakeChannel(
  state: Record<string, unknown[]>,
  {
    status = 'SUBSCRIBED',
    sync = true,
  }: { status?: Status; sync?: boolean } = {},
) {
  let onSync: (() => void) | null = null;
  const channel = {
    on: jest.fn((_type: string, _filter: unknown, cb: () => void): void => {
      onSync = cb;
    }),
    subscribe: jest.fn((cb: (s: Status) => void): void => {
      queueMicrotask(() => {
        cb(status);
        if (sync && status === 'SUBSCRIBED') onSync?.();
      });
    }),
    presenceState: jest.fn(() => state),
    unsubscribe: jest.fn().mockResolvedValue('ok'),
    teardown: jest.fn(),
  };
  return channel;
}

function readerWith(channel: ReturnType<typeof fakeChannel>) {
  const supabase = {
    channel: jest.fn(() => channel),
  } as unknown as FrappSupabaseClient;
  return { reader: new ChapterPresenceReader(supabase), supabase };
}

describe('presenceUserIds', () => {
  it('takes every entry the dots would count, once', () => {
    expect(
      presenceUserIds({
        a: [
          { userId: 'u1', ts: 1 },
          { userId: 'u1', ts: 2 },
        ],
        b: [{ userId: 'u2', ts: 3, status: 'dnd' }, { nope: true }, null],
        c: 'not a list',
      }),
    ).toEqual(new Set(['u1', 'u2']));
  });

  it('skips an entry with no numeric ts, which no Directory draws', () => {
    expect(
      presenceUserIds({
        a: [
          { userId: 'u1' },
          { userId: 'u2', ts: 'now' },
          { userId: '', ts: 1 },
        ],
      }),
    ).toEqual(new Set());
  });

  it('reads anything else as nobody', () => {
    expect(presenceUserIds(null)).toEqual(new Set());
    expect(presenceUserIds('x')).toEqual(new Set());
  });
});

describe('ChapterPresenceReader', () => {
  afterEach(() => jest.useRealTimers());

  it('joins the private chapter topic, reads the roster and lets go', async () => {
    const channel = fakeChannel({
      k: [
        { userId: 'u1', ts: 1 },
        { userId: 'u2', ts: 2 },
      ],
    });
    const { reader, supabase } = readerWith(channel);

    await expect(reader.onlineUserIds('ch-1')).resolves.toEqual(
      new Set(['u1', 'u2']),
    );
    expect(supabase.channel).toHaveBeenCalledWith(
      'presence:chapter:ch-1',
      expect.objectContaining({
        config: expect.objectContaining({
          private: true,
          presence: expect.objectContaining({ enabled: true }),
        }),
      }),
    );
    await Promise.resolve();
    expect(channel.unsubscribe).toHaveBeenCalled();
    expect(channel.teardown).toHaveBeenCalled();
  });

  it('shares one join between overlapping reads of a chapter', async () => {
    const channel = fakeChannel({ k: [{ userId: 'u1', ts: 1 }] });
    const { reader, supabase } = readerWith(channel);
    const [a, b] = await Promise.all([
      reader.onlineUserIds('ch-1'),
      reader.onlineUserIds('ch-1'),
    ]);
    expect(a).toBe(b);
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  it('takes the roster it holds when no sync follows the join', async () => {
    jest.useFakeTimers();
    const channel = fakeChannel({}, { sync: false });
    const { reader } = readerWith(channel);
    const read = reader.onlineUserIds('ch-1');
    await jest.advanceTimersByTimeAsync(CHAPTER_PRESENCE_SYNC_GRACE_MS);
    await expect(read).resolves.toEqual(new Set());
  });

  it('answers null at once when the join is refused', async () => {
    const channel = fakeChannel({}, { status: 'CHANNEL_ERROR' });
    const { reader } = readerWith(channel);
    await expect(reader.onlineUserIds('ch-1')).resolves.toBeNull();
    await Promise.resolve();
    expect(channel.teardown).toHaveBeenCalled();
  });

  it('answers null when the join never answers in time', async () => {
    jest.useFakeTimers();
    const channel = fakeChannel({});
    channel.subscribe.mockImplementation(() => undefined);
    const { reader } = readerWith(channel);
    const read = reader.onlineUserIds('ch-1');
    await jest.advanceTimersByTimeAsync(CHAPTER_PRESENCE_READ_TIMEOUT_MS);
    await expect(read).resolves.toBeNull();
  });

  it('waits for the last read to free the topic before joining it again', async () => {
    const channel = fakeChannel({ k: [{ userId: 'u1', ts: 1 }] });
    let freed: () => void = () => undefined;
    channel.unsubscribe.mockImplementation(
      () => new Promise<string>((resolve) => (freed = () => resolve('ok'))),
    );
    const { reader, supabase } = readerWith(channel);
    await reader.onlineUserIds('ch-1');
    const second = reader.onlineUserIds('ch-1');
    await new Promise((resolve) => setImmediate(resolve));
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    freed();
    await expect(second).resolves.toEqual(new Set(['u1']));
    expect(supabase.channel).toHaveBeenCalledTimes(2);
  });

  it(`reads at most ${MAX_CONCURRENT_CHAPTER_READS} chapters at once`, async () => {
    const channel = fakeChannel({});
    channel.subscribe.mockImplementation(() => undefined);
    const { reader, supabase } = readerWith(channel);
    jest.useFakeTimers();
    for (let i = 0; i < MAX_CONCURRENT_CHAPTER_READS; i += 1) {
      void reader.onlineUserIds(`ch-${i}`);
    }
    await expect(reader.onlineUserIds('ch-over')).resolves.toBeNull();
    expect(supabase.channel).toHaveBeenCalledTimes(
      MAX_CONCURRENT_CHAPTER_READS,
    );
    await jest.advanceTimersByTimeAsync(CHAPTER_PRESENCE_READ_TIMEOUT_MS);
  });

  it("joins the topic the clients publish on (@repo/hooks' chapterPresenceTopic)", () => {
    // The API can't import @repo/hooks, so it spells the prefix itself; this
    // fails when the clients' topic moves without it.
    const hooks = readFileSync(
      join(__dirname, '../../../../../packages/hooks/src/presence-topics.ts'),
      'utf8',
    );
    expect(hooks).toContain('return `presence:chapter:${chapterId}`;');
  });
});
