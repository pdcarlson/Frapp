/**
 * What `ChatRealtimeManager.resume()`'s socket probe assumes about realtime-js,
 * pinned against the real library (#3698).
 *
 * `realtime-manager.spec.ts` runs on a fake client, which can only replay what
 * its author believed realtime-js does. The beliefs `probeSocket` rests on are
 * checked here by driving the real `@supabase/supabase-js` client over a fake
 * WebSocket that plays the server's side, the way the API's
 * `realtime-js-contract.spec.ts` does for the push worker. A realtime-js or
 * phoenix upgrade that changes any of them fails this file rather than leaving
 * a backgrounded device on a dead socket:
 *
 * - `sendHeartbeat()` with nothing outstanding sends one heartbeat and exposes
 *   its ref as `pendingHeartbeatRef`; the server's reply clears it. So a probe
 *   can tell "the heartbeat I'm waiting on" from a newer one.
 * - `sendHeartbeat()` while one is still unanswered runs the client's heartbeat
 *   timeout: every joined channel reports `CHANNEL_ERROR` and the socket is
 *   replaced. So the probe's second call is Realtime's own recovery, and the
 *   probe must never make a first call while one is pending, which would run
 *   it on a live socket whose reply is merely in flight.
 *
 * Frames are vsn 2.0.0 text frames, `[join_ref, ref, topic, event, payload]`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  static opened: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  readonly protocol = "";
  binaryType = "arraybuffer";
  bufferedAmount = 0;
  onopen: ((ev: unknown) => unknown) | null = null;
  onmessage: ((ev: { data: string }) => unknown) | null = null;
  onclose: ((ev: unknown) => unknown) | null = null;
  onerror: ((ev: unknown) => unknown) | null = null;
  readonly frames: Frame[] = [];

  constructor(address: string | URL) {
    this.url = String(address);
    FakeWebSocket.opened.push(this);
  }

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Frame);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  accept(): void {
    this.readyState = this.OPEN;
    this.onopen?.({});
  }

  deliver(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const TOPIC = "chat:inbox:global";
const WIRE_TOPIC = `realtime:${TOPIC}`;

const latestSocket = () =>
  FakeWebSocket.opened[FakeWebSocket.opened.length - 1]!;
const heartbeatsOn = (ws: FakeWebSocket) =>
  ws.frames.filter(
    ([, , topic, ev]) => topic === "phoenix" && ev === "heartbeat",
  );

describe("realtime-js heartbeats, as resume()'s probe relies on them (#3698)", () => {
  let supabase: SupabaseClient;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.opened = [];
    supabase = createClient("http://localhost:54321", "anon-key", {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: {
        transport: FakeWebSocket as unknown as typeof WebSocket,
        // Far beyond any span a case advances, so only the heartbeats a case
        // sends itself are on the wire.
        heartbeatIntervalMs: 24 * 60 * 60 * 1000,
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** Joins one channel and returns the statuses it reports. */
  async function joined() {
    const statuses: string[] = [];
    supabase
      .channel(TOPIC)
      // A broadcast binding: the server echoes nothing back for it, so the
      // join needs no binding ids, and heartbeats are all this file is about.
      .on("broadcast", { event: "ping" }, () => {})
      .subscribe((status) => statuses.push(status));
    await vi.advanceTimersByTimeAsync(0);
    const ws = latestSocket();
    ws.accept();
    await vi.advanceTimersByTimeAsync(0);
    const join = ws.frames.find(
      ([, , topic, ev]) => topic === WIRE_TOPIC && ev === "phx_join",
    )!;
    ws.deliver([
      join[0],
      join[1],
      WIRE_TOPIC,
      "phx_reply",
      {
        status: "ok",
        response: {},
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toContain("SUBSCRIBED");
    return { ws, statuses };
  }

  test("a heartbeat with none outstanding is sent and exposed as pending until answered", async () => {
    const { ws } = await joined();
    expect(supabase.realtime.pendingHeartbeatRef).toBeNull();

    await supabase.realtime.sendHeartbeat();
    const [beat] = heartbeatsOn(ws);
    expect(beat).toBeDefined();
    expect(supabase.realtime.pendingHeartbeatRef).toBe(beat![1]);

    ws.deliver([
      null,
      beat![1],
      "phoenix",
      "phx_reply",
      {
        status: "ok",
        response: {},
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.realtime.pendingHeartbeatRef).toBeNull();
  });

  test("a heartbeat while one is unanswered errors every channel and replaces the socket", async () => {
    const { ws, statuses } = await joined();
    await supabase.realtime.sendHeartbeat();
    expect(supabase.realtime.pendingHeartbeatRef).not.toBeNull();

    await supabase.realtime.sendHeartbeat();
    // The timeout tears the old socket down (waiting out its close) and
    // schedules a reconnect.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(statuses).toContain("CHANNEL_ERROR");
    expect(latestSocket()).not.toBe(ws);
  });

  test("an answered heartbeat leaves a later one harmless", async () => {
    const { ws, statuses } = await joined();
    await supabase.realtime.sendHeartbeat();
    const [beat] = heartbeatsOn(ws);
    ws.deliver([
      null,
      beat![1],
      "phoenix",
      "phx_reply",
      {
        status: "ok",
        response: {},
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    await supabase.realtime.sendHeartbeat();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(statuses).not.toContain("CHANNEL_ERROR");
    expect(latestSocket()).toBe(ws);
  });
});
