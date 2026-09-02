import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Cover for the presence hook's own responsibilities.
 *
 * Attach/teardown correctness belongs to `attachRealtimeChannel`, tested in
 * `supabase-realtime.test.tsx` against a fake that reproduces the #783/#817
 * library behaviour. Mocking it here is deliberate — re-testing it would be a
 * second copy of that suite, and what is worth pinning at this layer is that
 * the hook *delegates* rather than hand-rolling a second attach path, which
 * `realtime-resilience` rule 1 forbids.
 *
 * **The mock defers `configure` and `onSubscribed` to a microtask, on purpose.**
 * The first version of this file called them synchronously, and that single
 * divergence from the real helper hid a real bug: the hook seeded its publish
 * straight after `attachRealtimeChannel(...)` returned, where the channel does
 * not exist yet, so it never published at all. The suite was green because the
 * fake modelled the assumption under test instead of the system under test. A
 * fake that is easier to satisfy than the real collaborator is not a fake.
 */

type AttachOptions = {
  private?: boolean;
  onSubscribed?: (channel: RealtimeChannel) => void;
  onDisconnected?: (status: string) => void;
};

type AttachArgs = [
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  options?: AttachOptions,
];

// Typed explicitly: a bare `vi.fn()` infers an empty argument tuple, so every
// `mock.calls[0][0]` below would fail `tsc` rather than the assertion.
const attachRealtimeChannel = vi.fn<(...args: AttachArgs) => () => void>();

vi.mock("@/lib/realtime/supabase-realtime", () => ({
  attachRealtimeChannel: (...args: AttachArgs) => attachRealtimeChannel(...args),
}));

import { useChapterPresence } from "./use-chapter-presence";
import { IDLE_AFTER_MS, PRESENCE_HEARTBEAT_MS } from "./presence-status";

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

/** Lets the mocked attach's microtask run, mirroring the real `enqueue`. */
async function settleAttach() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  fake = makeFakeChannel();
  detach = vi.fn<() => void>();
  attachRealtimeChannel.mockReset();
  attachRealtimeChannel.mockImplementation((_topic, configure, options) => {
    // Mirrors `enqueue`: the channel is minted on a microtask, never in the
    // caller's synchronous frame, and SUBSCRIBED arrives after that.
    void Promise.resolve().then(() => {
      configure(fake.channel);
      options?.onSubscribed?.(fake.channel);
    });
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

  test("subscribes to sync, join and leave", async () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
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

  /**
   * The regression that the synchronous fake hid. The channel does not exist
   * in the effect's own frame, so a publish attempted there reaches nothing and
   * the viewer is absent from their own presence map — rendering Offline to
   * everyone, including themselves.
   */
  test("publishes the viewer once the channel is actually subscribed", async () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    expect(fake.track).toHaveBeenCalledTimes(1);
    expect(fake.track.mock.calls[0]![0]).toMatchObject({ userId: "me" });
  });

  /**
   * `onSubscribed` fires again on every reconnect. Without a re-publish there,
   * a member who drops off the socket vanishes from the presence map for the
   * rest of the session — presence is connection-scoped, so the rejoin starts
   * from an empty entry.
   */
  test("re-publishes on every SUBSCRIBED, so a reconnect restores the viewer", async () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    const onSubscribed = attachRealtimeChannel.mock.calls[0]![2]?.onSubscribed;

    act(() => onSubscribed?.(fake.channel));

    expect(fake.track).toHaveBeenCalledTimes(2);
  });

  /**
   * No periodic re-publish: presence has no TTL, so re-sending an unchanged
   * payload would broadcast a diff to every subscriber and change nothing.
   */
  test("does not re-publish on a timer when nothing has changed", async () => {
    vi.useFakeTimers();
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterJoin = fake.track.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 10);
    });

    expect(fake.track).toHaveBeenCalledTimes(afterJoin);
  });

  test("a signed-out viewer subscribes but never publishes", async () => {
    renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: null }),
    );
    await settleAttach();
    expect(attachRealtimeChannel).toHaveBeenCalledTimes(1);
    expect(fake.track).not.toHaveBeenCalled();
  });

  /**
   * `viewerId` resolves from `/v1/users/me` after first paint. Keying the
   * channel on it would attach, tear down and re-attach on every cold load —
   * two joins, and a spurious leave/join seen by every other member.
   */
  test("a late-resolving viewerId does not re-mint the channel", async () => {
    const { rerender } = renderHook(
      ({ viewerId }: { viewerId: string | null }) =>
        useChapterPresence({ chapterId: CHAPTER, viewerId }),
      { initialProps: { viewerId: null as string | null } },
    );
    await settleAttach();

    rerender({ viewerId: "me" });
    await settleAttach();

    expect(attachRealtimeChannel).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  /**
   * The other half of keeping `viewerId` out of the channel's deps, and a real
   * bug on its own.
   *
   * On a cold load the id is `null` when the channel joins, so the
   * `onSubscribed` publish no-ops — and nothing fires afterwards, because the
   * effect does not re-run and SUBSCRIBED does not repeat. Without an explicit
   * publish on the transition, a member who opens the app and only *reads*
   * never appears online to anyone.
   */
  test("publishes when the profile resolves after the channel already joined", async () => {
    const { rerender } = renderHook(
      ({ viewerId }: { viewerId: string | null }) =>
        useChapterPresence({ chapterId: CHAPTER, viewerId }),
      { initialProps: { viewerId: null as string | null } },
    );
    await settleAttach();
    expect(fake.track).not.toHaveBeenCalled();

    rerender({ viewerId: "me" });

    expect(fake.track).toHaveBeenCalledTimes(1);
    expect(fake.track.mock.calls[0]![0]).toMatchObject({ userId: "me" });
  });

  test("reduces presence state into per-member status on sync", async () => {
    const now = Date.now();
    fake.setState({
      a: [{ userId: "u1", ts: now }],
      b: [{ userId: "u2", ts: now - (IDLE_AFTER_MS + 60_000) }],
    });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();

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
  });

  test("detaches on unmount", async () => {
    const { unmount } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();

    unmount();

    expect(detach).toHaveBeenCalledTimes(1);
  });

  /**
   * Switching chapters must not leave the previous chapter's roster on screen.
   * Presence is the one surface where stale data reads as a positive claim
   * about a specific person ("Ali is online") rather than as missing data.
   */
  test("drops the roster when the chapter changes", async () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result, rerender } = renderHook(
      ({ chapterId }: { chapterId: string | null }) =>
        useChapterPresence({ chapterId, viewerId: "me" }),
      { initialProps: { chapterId: CHAPTER as string | null } },
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    expect(result.current.isReady).toBe(true);

    rerender({ chapterId: null });

    expect(result.current.isReady).toBe(false);
    expect(result.current.statusOf("u1")).toBe("offline");
    expect(detach).toHaveBeenCalled();
  });

  /**
   * The hole the chapter-only stamp left. A wifi flap flips `enabled`
   * false→true with the chapter unchanged, and the pre-outage roster must not
   * be re-adopted as current — members who closed the app during the outage
   * would render Online again, permanently so if the re-join then errored
   * (that path only warns).
   */
  test("does not re-adopt a pre-outage roster when the connection returns", async () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useChapterPresence({ chapterId: CHAPTER, viewerId: "me", enabled }),
      { initialProps: { enabled: true } },
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    expect(result.current.statusOf("u1")).toBe("online");

    rerender({ enabled: false });
    expect(result.current.isReady).toBe(false);

    rerender({ enabled: true });

    // Re-attached, but no sync has landed yet — so nothing is claimed.
    expect(result.current.isReady).toBe(false);
    expect(result.current.statusOf("u1")).toBe("offline");
  });

  /**
   * The case the attach generation does *not* cover. A socket drop that never
   * flips `navigator.onLine` — a proxy dying, a server-side close, an errored
   * re-join loop — leaves `enabled` true and the chapter unchanged, so the last
   * roster we happened to see would otherwise render as fact for the rest of
   * the session, naming people Online who left hours ago.
   */
  test("a dropped channel stops the roster being current", async () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    expect(result.current.statusOf("u1")).toBe("online");

    const onDisconnected =
      attachRealtimeChannel.mock.calls[0]![2]?.onDisconnected;
    act(() => onDisconnected?.("CHANNEL_ERROR"));

    expect(result.current.isReady).toBe(false);
    expect(result.current.statusOf("u1")).toBe("offline");
  });

  test("a re-join after a drop makes the roster current again", async () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    const options = attachRealtimeChannel.mock.calls[0]![2];

    act(() => options?.onDisconnected?.("TIMED_OUT"));
    act(() => options?.onSubscribed?.(fake.channel));
    act(() => fake.fire("sync"));

    expect(result.current.isReady).toBe(true);
    expect(result.current.statusOf("u1")).toBe("online");
  });

  /**
   * The join reply arrives strictly *before* the server's `presence_state`, so
   * a flag flipped on SUBSCRIBED republishes the pre-drop roster in the gap.
   * A laptop waking after two hours would show everyone who was online then.
   * The roster is stamped with the connection it was read on, so a new join is
   * a new id and the old roster simply stops matching.
   */
  test("a re-join does not republish the pre-drop roster before a fresh sync", async () => {
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    const options = attachRealtimeChannel.mock.calls[0]![2];

    act(() => options?.onDisconnected?.("CHANNEL_ERROR"));
    act(() => options?.onSubscribed?.(fake.channel));

    // Joined again, but nothing fresh has been delivered yet.
    expect(result.current.isReady).toBe(false);
    expect(result.current.statusOf("u1")).toBe("offline");
  });

  /**
   * Release and attach are queued under different topics, so on a chapter
   * switch they run concurrently and the replaced channel's `CLOSED` can land
   * after the new one has joined. Ungated, that turned presence off for the
   * rest of the session — no dots at all, and nothing to re-enable them.
   */
  test("a late CLOSED from a replaced channel does not silence the live one", async () => {
    const { result, rerender } = renderHook(
      ({ chapterId }: { chapterId: string }) =>
        useChapterPresence({ chapterId, viewerId: "me" }),
      { initialProps: { chapterId: CHAPTER } },
    );
    await settleAttach();
    const stale = attachRealtimeChannel.mock.calls[0]![2];

    const OTHER = "99999999-8888-7777-6666-555555555555";
    rerender({ chapterId: OTHER });
    await settleAttach();
    fake.setState({ a: [{ userId: "u1", ts: Date.now() }] });
    act(() => fake.fire("sync"));
    expect(result.current.isReady).toBe(true);

    // The replaced channel's teardown finally settles.
    act(() => stale?.onDisconnected?.("CLOSED"));

    expect(result.current.isReady).toBe(true);
    expect(result.current.statusOf("u1")).toBe("online");
  });

  /**
   * The Idle clock only advances while there is a roster to age, so it freezes
   * across a gap. A roster that resumes after one must not be judged against
   * the pre-gap clock — a member genuinely inactive for six minutes would read
   * Online, because a stale `now` puts their timestamp in the future.
   */
  test("a roster arriving after a long gap is judged against a fresh clock", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // No roster for ten minutes, so nothing advances the clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    // Now a member appears who has been inactive for six minutes.
    fake.setState({ a: [{ userId: "u1", ts: start + 4 * 60 * 1000 }] });
    act(() => fake.fire("sync"));

    expect(result.current.statusOf("u1")).toBe("idle");
  });

  /**
   * A peer re-publishing produces a presence diff whose reduced result is
   * identical. Swapping in an equal Map would churn identity and re-render the
   * whole directory to change nothing on screen.
   */
  test("an unchanged roster does not produce a new object identity", async () => {
    fake.setState({ a: [{ userId: "u1", ts: 1000 }] });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    const first = result.current.statusOf;

    act(() => fake.fire("sync"));
    act(() => fake.fire("join"));

    expect(result.current.statusOf).toBe(first);
  });

  test("a changed roster does produce a new identity", async () => {
    fake.setState({ a: [{ userId: "u1", ts: 1000 }] });
    const { result } = renderHook(() =>
      useChapterPresence({ chapterId: CHAPTER, viewerId: "me" }),
    );
    await settleAttach();
    act(() => fake.fire("sync"));
    const first = result.current.statusOf;

    fake.setState({ a: [{ userId: "u1", ts: 1000 }, { userId: "u2", ts: 2000 }] });
    act(() => fake.fire("sync"));

    await waitFor(() => expect(result.current.statusOf).not.toBe(first));
  });
});
