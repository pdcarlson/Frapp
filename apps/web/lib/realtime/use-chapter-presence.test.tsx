import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Cover for the presence hook's own responsibilities.
 *
 * Attach/teardown correctness is `attachRealtimeChannel`'s, tested in
 * `supabase-realtime.test.tsx` against a fake that reproduces the #783/#817
 * library behaviour. Mocking it here is deliberate: re-testing it would be a
 * second copy of that suite, and the thing worth pinning at this layer is that
 * the hook *delegates* rather than hand-rolling a second attach path — which
 * `realtime-resilience` rule 1 forbids.
 */

type AttachArgs = [
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  options?: { private?: boolean },
];

// Typed explicitly: a bare `vi.fn()` infers an empty argument tuple, so every
// `mock.calls[0][0]` below would fail `tsc` rather than the assertion.
const attachRealtimeChannel = vi.fn<(...args: AttachArgs) => () => void>();

vi.mock("@/lib/realtime/supabase-realtime", () => ({
  attachRealtimeChannel: (...args: AttachArgs) => attachRealtimeChannel(...args),
}));

import { useChapterPresence } from "./use-chapter-presence";
import { PRESENCE_HEARTBEAT_MS } from "./presence-status";

type Handler = (payload?: unknown) => void;

function makeFakeChannel() {
  const handlers = new Map<string, Handler>();
  let state: Record<string, unknown[]> = {};
  const track =
    vi.fn<(payload: { userId: string; ts: number }) => Promise<string>>(
      async () => "ok",
    );
  const channel = {
    on: vi.fn((type: string, filter: { event: string }, handler: Handler) => {
      handlers.set(`${type}:${filter.event}`, handler);
      return channel;
    }),
    track,
    presenceState: () => state,
  };
  return {
    channel: channel as unknown as RealtimeChannel,
    track,
    setState(next: Record<string, unknown[]>) {
      state = next;
    },
    fire(event: string) {
      handlers.get(`presence:${event}`)?.();
    },
    hasHandler(event: string) {
      return handlers.has(`presence:${event}`);
    },
  };
}

let fake: ReturnType<typeof makeFakeChannel>;
let detach: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  fake = makeFakeChannel();
  detach = vi.fn<() => void>();
  attachRealtimeChannel.mockReset();
  attachRealtimeChannel.mockImplementation((_topic, configure) => {
    configure(fake.channel);
    return detach;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const CHAPTER = "11111111-2222-3333-4444-555555555555";

describe("useChapterPresence", () => {
  test("attaches on the chapter presence topic, through the shared helper", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    expect(attachRealtimeChannel).toHaveBeenCalledTimes(1);
    expect(attachRealtimeChannel.mock.calls[0]![0]).toBe(
      `presence:chapter:${CHAPTER}`,
    );
  });

  /**
   * A public channel, not `private: true`. The private-channel authoriser
   * (`realtime_messages_scoped_select`) ends in `else false`, so a private
   * presence topic would join, report SUBSCRIBED and silently never deliver —
   * the exact shape that hid #867 for months. If someone later flips this on,
   * this test is where they find out it needs an RLS branch too.
   */
  test("does not request a private channel", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    expect(attachRealtimeChannel.mock.calls[0]![2]?.private).toBeFalsy();
  });

  test("subscribes to sync, join and leave", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    expect(fake.hasHandler("sync")).toBe(true);
    expect(fake.hasHandler("join")).toBe(true);
    expect(fake.hasHandler("leave")).toBe(true);
  });

  test("does not attach without a chapter id", () => {
    renderHook(() => useChapterPresence({ chapterId: null, viewerId: "me" }));
    expect(attachRealtimeChannel).not.toHaveBeenCalled();
  });

  test("does not attach when disabled", () => {
    renderHook(() =>
      useChapterPresence({
        chapterId: CHAPTER,
        viewerId: "me",
        enabled: false,
      }),
    );
    expect(attachRealtimeChannel).not.toHaveBeenCalled();
  });

  test("tracks the viewer immediately, then on every heartbeat", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    expect(fake.track).toHaveBeenCalledTimes(1);
    expect(fake.track.mock.calls[0]![0]).toMatchObject({ userId: "me" });

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2);
    });
    expect(fake.track).toHaveBeenCalledTimes(3);
  });

  /**
   * The heartbeat must re-send the *unchanged* activity timestamp. If it
   * stamped `Date.now()` each time, `ts` would never age past the 5-minute
   * threshold and Idle would be unreachable — the bug this payload shape
   * exists to prevent.
   */
  test("heartbeats re-send the same activity timestamp, so Idle stays reachable", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    const first = fake.track.mock.calls[0]![0].ts;

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 10);
    });

    const last = fake.track.mock.calls.at(-1)![0];
    expect(last.ts).toBe(first);
  });

  test("a signed-out viewer subscribes but never tracks", () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: null }),
    );
    expect(attachRealtimeChannel).toHaveBeenCalledTimes(1);
    expect(fake.track).not.toHaveBeenCalled();
  });

  test("reduces presence state into per-member status on sync", () => {
    const now = Date.now();
    fake.setState({
      a: [{ userId: "u1", ts: now }],
      b: [{ userId: "u2", ts: now - 6 * 60 * 1000 }],
    });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );

    act(() => fake.fire("sync"));

    expect(result.current.isReady).toBe(true);
    expect(result.current.statusOf("u1")).toBe("online");
    expect(result.current.statusOf("u2")).toBe("idle");
    expect(result.current.statusOf("nobody")).toBe("offline");
  });

  test("is not ready before the first sync, so nothing renders as Offline yet", () => {
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.presentSince.size).toBe(0);
  });

  test("detaches and stops heartbeating on unmount", () => {
    const { unmount } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    const before = fake.track.mock.calls.length;

    unmount();

    expect(detach).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 5);
    });
    expect(fake.track).toHaveBeenCalledTimes(before);
  });

  /**
   * Switching chapters must not leave the previous chapter's roster on screen.
   * Presence is the one surface where stale data reads as a positive claim
   * about a specific person ("Ali is online") rather than as missing data.
   */
  test("clears the roster when the chapter changes", () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result, rerender } = renderHook(
      ({ chapterId }: { chapterId: string | null }) =>
        useChapterPresence({ chapterId, viewerId: "me" }),
      { initialProps: { chapterId: CHAPTER as string | null } },
    );
    act(() => fake.fire("sync"));
    expect(result.current.presentSince.size).toBe(1);

    rerender({ chapterId: null });

    expect(result.current.presentSince.size).toBe(0);
    expect(result.current.isReady).toBe(false);
    expect(detach).toHaveBeenCalled();
  });
});
