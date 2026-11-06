import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * What `WorkerSubscription` assumes about realtime-js, pinned against the real
 * library (#3365).
 *
 * The worker specs run on `test/helpers/fake-realtime.ts`, which can only
 * replay what its author believed realtime-js does. The beliefs that decide
 * the worker's design are checked here instead, by driving the real
 * `@supabase/supabase-js` client, built with the API provider's own auth
 * options, over a fake WebSocket that plays the server's side of the phoenix
 * protocol. A realtime-js or phoenix upgrade that changes any of them fails
 * this file rather than leaving the worker quietly wrong:
 *
 * - A join that times out, a join the server refuses, and a `phx_error` are
 *   all rejoined by phoenix itself, on the same channel object, with its
 *   listeners intact. So the worker must not reopen on `TIMED_OUT` or
 *   `CHANNEL_ERROR`: that would race phoenix's own rejoin.
 * - A `phx_close` is never rejoined, and drops the channel from the client.
 *   So `CLOSED` is the one status the worker reopens on, and a fresh
 *   `channel(topic)` is a new instance.
 * - A socket outage gives one `CHANNEL_ERROR` however long it lasts, then a
 *   rejoin once the socket opens. So the outage alarm has to be time-based:
 *   counting statuses never trips during the outage that matters most.
 * - `channel(topic)` hands back a still-registered instance, and binding a
 *   listener on it once it is joining throws. So every reopen frees the topic
 *   first (the realtime-resilience skill's rule 1).
 * - `removeChannel` echoes `CLOSED` through the channel's own status callback
 *   before it resolves, and a binding mismatch reports `CLOSED` and then
 *   `CHANNEL_ERROR`. So the worker ignores statuses from a channel it no longer
 *   holds.
 *
 * Frames are vsn 2.0.0 text frames, `[join_ref, ref, topic, event, payload]`,
 * the realtime-js default.
 */

type Frame = [
  string | null,
  string | null,
  string,
  string,
  Record<string, unknown>,
];

/** A WebSocket whose server side the spec plays by hand. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket the client opened, oldest first. */
  static opened: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  readonly protocol = '';
  binaryType = 'arraybuffer';
  onopen: ((ev: unknown) => unknown) | null = null;
  onmessage: ((ev: { data: string }) => unknown) | null = null;
  onclose: ((ev: unknown) => unknown) | null = null;
  onerror: ((ev: unknown) => unknown) | null = null;
  /** Every frame the client sent on this socket. */
  readonly frames: Frame[] = [];

  constructor(address: string | URL) {
    this.url = String(address);
    FakeWebSocket.opened.push(this);
  }

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Frame);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  // The server's side.

  accept(): void {
    this.readyState = this.OPEN;
    this.onopen?.({});
  }

  deliver(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** The connection fails or drops, the way `ws` reports it. */
  fail(): void {
    this.readyState = this.CLOSED;
    this.onerror?.({});
    this.onclose?.({ code: 1006, reason: '', wasClean: false });
  }
}

const TOPIC = 'contract:messages';
const WIRE_TOPIC = `realtime:${TOPIC}`;
const BINDING = {
  event: 'INSERT',
  schema: 'public',
  table: 'chat_messages',
} as const;
/** The server's id for the binding, which postgres_changes frames carry. */
const BINDING_ID = 41;
/** realtime-js's default join timeout. */
const JOIN_TIMEOUT_MS = 10_000;
/** phoenix's first rejoin delay. */
const FIRST_REJOIN_MS = 1_000;

const latestSocket = () =>
  FakeWebSocket.opened[FakeWebSocket.opened.length - 1];
const sentOn = (ws: FakeWebSocket, event: string) =>
  ws.frames.filter(([, , topic, ev]) => topic === WIRE_TOPIC && ev === event);
const joinsOn = (ws: FakeWebSocket) => sentOn(ws, 'phx_join');

function reply(
  ws: FakeWebSocket,
  [joinRef, ref, topic]: Frame,
  status: 'ok' | 'error',
  response: Record<string, unknown>,
): void {
  ws.deliver([joinRef, ref, topic, 'phx_reply', { status, response }]);
}

/** The server accepts a join and echoes the binding it set up. */
function acceptJoin(
  ws: FakeWebSocket,
  join: Frame,
  binding: Record<string, unknown> = BINDING,
): void {
  reply(ws, join, 'ok', {
    postgres_changes: [{ id: BINDING_ID, ...binding }],
  });
}

/** The server delivers an INSERT on the joined binding. */
function insert(ws: FakeWebSocket, id: string): void {
  ws.deliver([
    null,
    null,
    WIRE_TOPIC,
    'postgres_changes',
    {
      ids: [BINDING_ID],
      data: {
        schema: 'public',
        table: 'chat_messages',
        commit_timestamp: '2026-11-04T00:00:00.000Z',
        type: 'INSERT',
        record: { id },
        columns: [{ name: 'id', type: 'text' }],
        errors: null,
      },
    },
  ]);
}

describe('realtime-js, as WorkerSubscription relies on it', () => {
  let supabase: SupabaseClient;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.opened = [];
    supabase = createClient('http://localhost:54321', 'service-role-key', {
      // The API provider's auth options (`supabase.provider.ts`).
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: {
        transport: FakeWebSocket,
        // Far beyond any span a case advances, so no heartbeat frame or
        // heartbeat timeout interleaves with the protocol under test.
        heartbeatIntervalMs: 24 * 60 * 60 * 1000,
      },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** Open a channel the way the worker does, recording what it reports. */
  function subscribe() {
    const statuses: string[] = [];
    const rows: string[] = [];
    const channel = supabase
      .channel(TOPIC)
      .on('postgres_changes', BINDING, (payload) => {
        rows.push(String(payload.new.id));
      })
      .subscribe((status) => statuses.push(status));
    const ws = latestSocket();
    ws.accept();
    return { channel, statuses, rows, ws };
  }

  /** Open a channel and let the server accept its join. */
  function subscribed() {
    const opened = subscribe();
    acceptJoin(opened.ws, joinsOn(opened.ws)[0]);
    expect(opened.statuses).toEqual(['SUBSCRIBED']);
    return opened;
  }

  describe('rejoins on its own', () => {
    it('a join that timed out, on the same channel and listeners', async () => {
      const { channel, statuses, rows, ws } = subscribe();
      expect(joinsOn(ws)).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
      expect(statuses).toEqual(['TIMED_OUT']);

      await jest.advanceTimersByTimeAsync(FIRST_REJOIN_MS);
      expect(joinsOn(ws)).toHaveLength(2);
      acceptJoin(ws, joinsOn(ws)[1]);

      expect(statuses).toEqual(['TIMED_OUT', 'SUBSCRIBED']);
      expect(supabase.getChannels()).toEqual([channel]);
      insert(ws, 'm-1');
      expect(rows).toEqual(['m-1']);
    });

    it('a join the server refused', async () => {
      const { statuses, rows, ws } = subscribe();
      reply(ws, joinsOn(ws)[0], 'error', { reason: 'unavailable' });
      expect(statuses).toEqual(['CHANNEL_ERROR']);

      await jest.advanceTimersByTimeAsync(FIRST_REJOIN_MS);
      expect(joinsOn(ws)).toHaveLength(2);
      acceptJoin(ws, joinsOn(ws)[1]);

      expect(statuses).toEqual(['CHANNEL_ERROR', 'SUBSCRIBED']);
      insert(ws, 'm-1');
      expect(rows).toEqual(['m-1']);
    });

    it('a channel the server errored', async () => {
      const { statuses, rows, ws } = subscribed();
      const [joinRef] = joinsOn(ws)[0];
      ws.deliver([joinRef, null, WIRE_TOPIC, 'phx_error', {}]);
      expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR']);

      await jest.advanceTimersByTimeAsync(FIRST_REJOIN_MS);
      expect(joinsOn(ws)).toHaveLength(2);
      acceptJoin(ws, joinsOn(ws)[1]);

      expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR', 'SUBSCRIBED']);
      insert(ws, 'm-1');
      expect(rows).toEqual(['m-1']);
    });
  });

  describe('a channel the server closed', () => {
    it('is never rejoined, and leaves the client', async () => {
      const { channel, statuses, ws } = subscribed();
      const [joinRef] = joinsOn(ws)[0];
      ws.deliver([joinRef, null, WIRE_TOPIC, 'phx_close', {}]);

      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(statuses).toEqual(['SUBSCRIBED', 'CLOSED']);
      expect(joinsOn(ws)).toHaveLength(1);
      expect(supabase.getChannels()).toEqual([]);
      // So the worker's reopen gets a new channel, not the closed one.
      expect(supabase.channel(TOPIC)).not.toBe(channel);
    });

    it('is what a postgres_changes binding mismatch ends in: CLOSED, then CHANNEL_ERROR', () => {
      // realtime-js leaves the channel and only then reports the error, so the
      // worker reopens on the CLOSED and ignores the CHANNEL_ERROR, which comes
      // from a channel it has already let go of.
      const { statuses, ws } = subscribe();
      acceptJoin(ws, joinsOn(ws)[0], { ...BINDING, table: 'some_other_table' });

      expect(statuses).toEqual(['CLOSED', 'CHANNEL_ERROR']);
      expect(sentOn(ws, 'phx_leave')).toHaveLength(1);
      expect(supabase.getChannels()).toEqual([]);
    });
  });

  describe('a socket outage', () => {
    it('gives one CHANNEL_ERROR however long it lasts, then rejoins on reconnect', async () => {
      const { channel, statuses, rows, ws } = subscribed();
      ws.fail();

      // Five minutes of reconnects that each fail.
      for (let elapsed = 0; elapsed < 5 * 60 * 1000; elapsed += 5_000) {
        await jest.advanceTimersByTimeAsync(5_000);
        const next = latestSocket();
        if (next !== ws && next.readyState === next.CONNECTING) next.fail();
      }
      expect(FakeWebSocket.opened.length).toBeGreaterThan(10);
      expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR']);

      await jest.advanceTimersByTimeAsync(5_000);
      const back = latestSocket();
      back.accept();
      expect(joinsOn(back)).toHaveLength(1);
      acceptJoin(back, joinsOn(back)[0]);

      expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR', 'SUBSCRIBED']);
      expect(supabase.getChannels()).toEqual([channel]);
      insert(back, 'm-1');
      expect(rows).toEqual(['m-1']);
    });
  });

  describe('freeing a topic', () => {
    it('channel(topic) returns the registered instance, which takes no new listener once joining', () => {
      const { channel } = subscribe();
      const again = supabase.channel(TOPIC);
      expect(again).toBe(channel);
      expect(() =>
        again.on('postgres_changes', BINDING, () => undefined),
      ).toThrow(
        `cannot add \`postgres_changes\` callbacks for ${WIRE_TOPIC} after \`subscribe()\`.`,
      );
    });

    it('removeChannel echoes CLOSED through the status callback, then resolves ok without waiting for the server', async () => {
      // phoenix's leave() marks the channel leaving before it checks whether
      // it can push, so the leave counts as acked at once. The server's reply
      // never arrives here, and the removal still resolves `ok`.
      const { channel, statuses, ws } = subscribed();
      await supabase
        .removeChannel(channel)
        .then((left) => statuses.push(`resolved ${left}`));

      expect(sentOn(ws, 'phx_leave')).toHaveLength(1);
      expect(statuses).toEqual(['SUBSCRIBED', 'CLOSED', 'resolved ok']);
      expect(supabase.getChannels()).toEqual([]);
    });
  });
});
