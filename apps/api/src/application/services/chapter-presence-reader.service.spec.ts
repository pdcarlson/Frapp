import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import {
  CHAPTER_PRESENCE_READ_TIMEOUT_MS,
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
  it('takes every entry with a string userId, once', () => {
    expect(
      presenceUserIds({
        a: [
          { userId: 'u1', ts: 1 },
          { userId: 'u1', ts: 2 },
        ],
        b: [{ userId: 'u2', status: 'dnd' }, { nope: true }, null],
        c: 'not a list',
      }),
    ).toEqual(new Set(['u1', 'u2']));
  });

  it('reads anything else as nobody', () => {
    expect(presenceUserIds(null)).toEqual(new Set());
    expect(presenceUserIds('x')).toEqual(new Set());
  });
});

describe('ChapterPresenceReader', () => {
  afterEach(() => jest.useRealTimers());

  it('joins the private chapter topic, reads the roster and lets go', async () => {
    const channel = fakeChannel({ k: [{ userId: 'u1' }, { userId: 'u2' }] });
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
    const channel = fakeChannel({ k: [{ userId: 'u1' }] });
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

  it('answers null when the join never lands in time', async () => {
    jest.useFakeTimers();
    const channel = fakeChannel({}, { status: 'CHANNEL_ERROR' });
    const { reader } = readerWith(channel);
    const read = reader.onlineUserIds('ch-1');
    await jest.advanceTimersByTimeAsync(CHAPTER_PRESENCE_READ_TIMEOUT_MS);
    await expect(read).resolves.toBeNull();
    expect(channel.teardown).toHaveBeenCalled();
  });
});
