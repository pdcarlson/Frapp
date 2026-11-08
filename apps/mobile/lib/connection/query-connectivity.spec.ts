import {
  markChannelReadMutationKey,
  markNotificationReadMutationKey,
} from "@repo/hooks";
import {
  focusManager,
  MutationObserver,
  onlineManager,
  QueryObserver,
} from "@tanstack/react-query";
import type { AppStateStatus } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../query-client";
import { createConnectionMonitor, type MonitorDeps } from "./monitor";
import { bindQueryConnectivity } from "./query-connectivity";

/**
 * The resume ordering behind #3747, with a fake `AppState`, the real monitor
 * and the real `onlineManager`/`focusManager`, against the app's own
 * `queryClient` and its real defaults.
 *
 * iOS tears down a suspended app's sockets, so the first request after a
 * resume can die on the dead pooled connection with the link up. What has to
 * hold: whatever retries that failure waits until the monitor's foreground
 * probe has answered, and doesn't fire into the same dead socket the instant
 * `AppState` reports `active`.
 */

const LOST = new TypeError("The network connection was lost.");

type AppStateListener = (state: AppStateStatus) => void;

function fakeAppState(initial: AppStateStatus = "active") {
  const listeners = new Set<AppStateListener>();
  const appState = {
    currentState: initial as AppStateStatus,
    addEventListener: vi.fn((_type: "change", listener: AppStateListener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
  };
  return {
    appState,
    /** RN updates `currentState` before the listeners run. */
    emit(next: AppStateStatus) {
      appState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

/** A `/health` probe the test answers by hand. */
function controllableHealth() {
  const pending: Array<(response: Response) => void> = [];
  const fetchImpl = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    probes: () => pending.length,
    answer() {
      const resolve = pending.shift();
      if (!resolve) throw new Error("no probe in flight");
      resolve(new Response("{}", { status: 200 }));
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("bindQueryConnectivity across a background → foreground", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  let teardown: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.test/v1";
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    queryClient.mount();
    teardown.push(() => queryClient.unmount());
  });

  afterEach(() => {
    for (const fn of teardown.reverse()) fn();
    teardown = [];
    queryClient.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    vi.useRealTimers();
  });

  function setup() {
    const { appState, emit } = fakeAppState("active");
    const health = controllableHealth();
    const deps: Partial<MonitorDeps> = {
      getState: vi
        .fn()
        .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      fetch: health.fetch,
      appState,
    };
    const monitor = createConnectionMonitor(deps);
    monitor.start();
    teardown.push(() => monitor.stop());
    teardown.push(bindQueryConnectivity(monitor, appState));
    return { monitor, health, emit };
  }

  /** Background, then return; the monitor's foreground probe is now in flight. */
  async function suspendAndResume(
    emit: (next: AppStateStatus) => void,
    health: ReturnType<typeof controllableHealth>,
  ) {
    // The cold-start probe answers first, so the monitor starts ONLINE.
    await flush();
    health.answer();
    await flush();
    emit("background");
    emit("active");
    await flush();
    expect(health.probes()).toBe(1);
  }

  it("holds focus after the return until the foreground probe answers", async () => {
    const { monitor, health, emit } = setup();
    await flush();
    health.answer();
    await flush();

    emit("background");
    expect(focusManager.isFocused()).toBe(false);
    expect(monitor.resumePending()).toBe(true);

    emit("active");
    await flush();
    expect(focusManager.isFocused()).toBe(false);
    expect(monitor.resumePending()).toBe(true);

    health.answer();
    await flush();
    expect(monitor.resumePending()).toBe(false);
    expect(focusManager.isFocused()).toBe(true);
  });

  it("does not hold focus for `inactive` → `active` (no background in between)", async () => {
    const { health, emit } = setup();
    await flush();
    health.answer();
    await flush();

    emit("inactive");
    expect(focusManager.isFocused()).toBe(true);
    emit("active");
    expect(focusManager.isFocused()).toBe(true);
  });

  it("refocuses on a counted probe failure too: the verdict is in, onlineManager decides the rest", async () => {
    const { appState, emit } = fakeAppState("active");
    const fetchImpl = vi.fn().mockRejectedValue(LOST);
    const monitor = createConnectionMonitor({
      getState: vi
        .fn()
        .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      fetch: fetchImpl as unknown as typeof fetch,
      appState,
    });
    monitor.start();
    teardown.push(() => monitor.stop());
    teardown.push(bindQueryConnectivity(monitor, appState));
    await vi.advanceTimersByTimeAsync(3_000);

    emit("background");
    emit("active");
    await flush();
    // A first failure after the wake waits for its confirm retry.
    expect(focusManager.isFocused()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(monitor.resumePending()).toBe(false);
    expect(focusManager.isFocused()).toBe(true);
  });

  it("releases focus when the monitor stops mid-resume", async () => {
    const { monitor, health, emit } = setup();
    await suspendAndResume(emit, health);
    expect(focusManager.isFocused()).toBe(false);
    monitor.stop();
    expect(focusManager.isFocused()).toBe(true);
  });

  it("keeps focus off when the monitor stops while the app is in the background", async () => {
    const { monitor, health, emit } = setup();
    await flush();
    health.answer();
    await flush();
    emit("background");
    // `stop()` releases a pending return; in the background that release must
    // not hand focus back.
    monitor.stop();
    expect(focusManager.isFocused()).toBe(false);
  });

  it("hands focus back when the runtime remounts mid-resume (stop, unbind, start, bind)", async () => {
    const { appState, emit } = fakeAppState("active");
    const health = controllableHealth();
    const deps: Partial<MonitorDeps> = {
      getState: vi
        .fn()
        .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      fetch: health.fetch,
      appState,
    };
    const monitor = createConnectionMonitor(deps);
    monitor.start();
    let unbind = bindQueryConnectivity(monitor, appState);
    teardown.push(() => monitor.stop());
    teardown.push(() => unbind());
    await suspendAndResume(emit, health);
    expect(focusManager.isFocused()).toBe(false);

    // `useConnectionRuntime`'s cleanup and effect, as a Fast Refresh runs them.
    monitor.stop();
    unbind();
    monitor.start();
    unbind = bindQueryConnectivity(monitor, appState);
    expect(focusManager.isFocused()).toBe(true);
  });

  it("hands focus back on a rebind even when the old binding was gone before stop", async () => {
    const { appState, emit } = fakeAppState("active");
    const health = controllableHealth();
    const monitor = createConnectionMonitor({
      getState: vi
        .fn()
        .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      fetch: health.fetch,
      appState,
    });
    monitor.start();
    let unbind = bindQueryConnectivity(monitor, appState);
    teardown.push(() => monitor.stop());
    teardown.push(() => unbind());
    await suspendAndResume(emit, health);

    unbind();
    monitor.stop();
    monitor.start();
    unbind = bindQueryConnectivity(monitor, appState);
    expect(focusManager.isFocused()).toBe(true);
  });

  it("parks a push tap's notification read receipt through a resume-time drop too", async () => {
    const { health, emit } = setup();
    await suspendAndResume(emit, health);

    const mutationFn = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockRejectedValueOnce(LOST)
      .mockResolvedValueOnce({ ok: true });
    const observer = new MutationObserver(queryClient, {
      mutationKey: markNotificationReadMutationKey,
      mutationFn,
    });
    const result = observer.mutate("notif-1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mutationFn).toHaveBeenCalledTimes(1);

    health.answer();
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ ok: true });
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("parks mark-read's retry through a resume-time drop and sends it after the probe answers", async () => {
    const { health, emit } = setup();
    await suspendAndResume(emit, health);

    // chat-thread takes focus the moment the app returns (a notification tap)
    // and stamps the read cursor; the request dies on the suspended socket.
    const mutationFn = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockRejectedValueOnce(LOST)
      .mockResolvedValueOnce({ ok: true });
    const observer = new MutationObserver(queryClient, {
      mutationKey: markChannelReadMutationKey,
      mutationFn,
    });
    const result = observer.mutate("channel-1");

    // Well past the retry delay: the retryer is parked, not spinning.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().isPaused).toBe(true);

    health.answer();
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ ok: true });
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("leaves every other mutation at retry 0, so a non-idempotent write fails visibly", async () => {
    setup();
    const mutationFn = vi.fn().mockRejectedValue(LOST);
    const observer = new MutationObserver(queryClient, {
      mutationKey: ["tasks", "create"],
      mutationFn,
    });
    await expect(observer.mutate(undefined)).rejects.toBe(LOST);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry mark-read on a definitive refusal", async () => {
    setup();
    const refusal = { statusCode: 403, error: "Forbidden", message: "no" };
    const mutationFn = vi.fn().mockRejectedValue(refusal);
    const observer = new MutationObserver(queryClient, {
      mutationKey: markChannelReadMutationKey,
      mutationFn,
    });
    const result = observer.mutate("channel-1").catch((error) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe(refusal);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it("parks a query's resume-time retry, and its focus refetch, until the probe answers", async () => {
    const { health, emit } = setup();
    const queryFn = vi.fn().mockResolvedValue(["row"]);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["channels"],
      queryFn,
      staleTime: 0,
    });
    teardown.push(observer.subscribe(() => undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    await suspendAndResume(emit, health);
    // Returning to the app did not refetch: focus is still held.
    expect(queryFn).toHaveBeenCalledTimes(1);

    // A request that goes out in the window anyway (a mount, a pull) dies on
    // the suspended socket. Its one retry must not go out before the probe.
    queryFn.mockRejectedValueOnce(LOST);
    void observer.refetch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().fetchStatus).toBe("paused");

    health.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(observer.getCurrentResult().data).toEqual(["row"]);
    expect(observer.getCurrentResult().isError).toBe(false);
  });
});
