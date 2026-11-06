/**
 * A Supabase Realtime stand-in for the API workers' specs: one channel object
 * per `channel()` call, each recording the status callback its `subscribe()`
 * was given, so a spec can drive `SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT` and
 * `CLOSED` itself.
 *
 * It keeps the realtime-js behaviour the workers depend on, and no more:
 *
 * - `teardown()` clears the channel's listeners, as phoenix's does, so a row
 *   delivered to a torn-down channel reaches nobody. A spec that proves rows
 *   flow again after a reopen is therefore proving the reopen registered new
 *   listeners, not replaying the old ones.
 * - `on()` after `subscribe()` throws, with realtime-js's message.
 * - `removeChannel()` leaves, echoes `CLOSED` through the channel's own status
 *   callback before it resolves, and tears down only when the leave was
 *   acknowledged `ok`.
 *
 * What the worker's design rests on (which statuses realtime-js rejoins by
 * itself, and which it never does) is pinned against the real library in
 * `src/application/workers/realtime-js-contract.spec.ts`, not here.
 */

type StatusCallback = (status: string, err?: Error) => void;
type Listener = {
  type: string;
  filter: { event?: string; schema?: string; table?: string };
  callback: (payload: unknown) => void;
};

export interface FakeChannel {
  topic: string;
  params: unknown;
  on: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  teardown: jest.Mock;
  presenceState: () => Record<string, unknown>;
  /** The status callback the worker passed to `subscribe` (a no-op until then). */
  status: StatusCallback;
  /**
   * Deliver a postgres_changes INSERT of `row` on `table`, the way the server
   * does. Returns how many listeners heard it: 0 for a torn-down channel.
   */
  insert: (table: string, row: Record<string, unknown>) => number;
}

export function fakeChannel(topic: string, params?: unknown): FakeChannel {
  let listeners: Listener[] = [];
  let subscribed = false;
  const ch: FakeChannel = {
    topic,
    params,
    on: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn().mockResolvedValue('ok'),
    teardown: jest.fn(() => {
      listeners = [];
    }),
    presenceState: () => ({}),
    status: () => undefined,
    insert: (table, row) => {
      const hearing = listeners.filter(
        (l) =>
          l.type === 'postgres_changes' &&
          l.filter.event === 'INSERT' &&
          l.filter.schema === 'public' &&
          l.filter.table === table,
      );
      for (const l of hearing) {
        l.callback({
          schema: 'public',
          table,
          commit_timestamp: '2026-11-04T00:00:00.000Z',
          eventType: 'INSERT',
          new: row,
          old: {},
          errors: [],
        });
      }
      return hearing.length;
    },
  };
  ch.on.mockImplementation(
    (
      type: string,
      filter: Listener['filter'],
      callback: Listener['callback'],
    ) => {
      if (subscribed) {
        throw new Error(
          `cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`,
        );
      }
      listeners.push({ type, filter, callback });
      return ch;
    },
  );
  ch.subscribe.mockImplementation((callback?: StatusCallback) => {
    subscribed = true;
    if (callback) ch.status = callback;
    return ch;
  });
  return ch;
}

export function fakeRealtime() {
  const opened: FakeChannel[] = [];
  const channel = jest.fn((topic: string, params?: unknown) => {
    const ch = fakeChannel(topic, params);
    opened.push(ch);
    return ch;
  });
  const removeChannel = jest.fn(async (ch: FakeChannel) => {
    const left = (await ch.unsubscribe()) as string;
    ch.status('CLOSED');
    if (left === 'ok') ch.teardown();
    return left;
  });
  const topicsOpened = () => opened.map((ch) => ch.topic);
  /** Every channel opened on `topic`, oldest first. */
  const onTopic = (topic: string) => opened.filter((ch) => ch.topic === topic);
  return { channel, removeChannel, opened, topicsOpened, onTopic };
}
