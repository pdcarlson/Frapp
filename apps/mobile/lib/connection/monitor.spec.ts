import { REQUEST_ID_HEADER } from "@repo/api-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnectionMonitor,
  healthUrl,
  LINK_DOWN_GRACE_MS,
  type MonitorDeps,
  CONFIRM_RETRY_MS,
} from "./monitor";
import type { ConnectionState } from "./state";

type LinkListener = (state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}) => void;

type AppStateListener = (state: string) => void;

/** Lets the probe's `fetch` and the `getState()` read settle. */
async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function harness(
  overrides: Partial<MonitorDeps> = {},
  { appState = "active" }: { appState?: string } = {},
) {
  let listener: LinkListener | null = null;
  let appStateListener: AppStateListener | null = null;
  // The grace timer is driven by hand, like the poll.
  let timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const fetchMock = vi.fn();
  const deps: MonitorDeps = {
    getState: vi
      .fn()
      .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
    addListener: vi.fn((next: LinkListener) => {
      listener = next;
      return { remove: vi.fn() };
    }),
    fetch: fetchMock,
    // The poll is driven by hand: a real interval would make every assertion a
    // race, and what is under test is the state machine, not setInterval.
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((fn: () => void, ms: number) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return timer;
    }),
    clearTimeout: vi.fn((timer: { live: boolean }) => {
      timer.live = false;
    }),
    appState: {
      currentState: appState,
      addEventListener: vi.fn((_type: string, next: AppStateListener) => {
        appStateListener = next;
        return { remove: vi.fn() };
      }),
    },
    ...overrides,
  } as unknown as MonitorDeps;

  const monitor = createConnectionMonitor(deps);
  const seen: ConnectionState[] = [];
  monitor.subscribe((state) => seen.push(state));
  return {
    monitor,
    deps,
    fetchMock,
    seen,
    link: () => listener,
    appState: (next: string) => appStateListener?.(next),
    /** Runs the pending grace timers, as if `ms` had passed. */
    elapse(ms: number) {
      const due = timers.filter((timer) => timer.live && timer.ms <= ms);
      timers = timers.filter((timer) => !due.includes(timer));
      for (const timer of due) {
        timer.live = false;
        timer.fn();
      }
    },
    pendingTimers: () => timers.filter((timer) => timer.live).length,
  };
}

const OK = { ok: true, status: 200 } as Response;
const SERVER_ERROR = { ok: false, status: 503 } as Response;
const RATE_LIMITED = { ok: false, status: 429 } as Response;

describe("healthUrl", () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  it("is null with no API configured", () => {
    expect(healthUrl()).toBeNull();
  });

  it("strips a trailing /v1, because /health is the one route not under it", () => {
    // A doubled `/v1` once made the web poll report ONLINE while every data
    // request 404'd. The normalization comes from the SDK so the two cannot
    // drift apart.
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com/v1";
    expect(healthUrl()).toBe("https://api.example.com/health");
  });

  it("leaves a bare origin alone", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    expect(healthUrl()).toBe("https://api.example.com/health");
  });
});

describe("connection monitor", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  it("starts optimistic, so a write is never blocked on an unread probe", () => {
    const { monitor } = harness();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("probes immediately on start, not only on the first interval tick", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    // Without this a cold start against a dead API reports ONLINE for a whole
    // poll period before the first failure lands — and OFFLINE needs three.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mints x-request-id on the health probe, not a sentry-trace id", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await Promise.resolve();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get(REQUEST_ID_HEADER)).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(headers.get("sentry-trace")).toBeNull();
    expect(headers.get("baggage")).toBeNull();
  });

  it("goes OFFLINE once a link drop outlasts the grace and /health confirms it", async () => {
    const { monitor, fetchMock, seen, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();

    fetchMock.mockRejectedValue(new Error("network unreachable"));
    link()?.({ isConnected: false, isInternetReachable: false });
    // A Wi-Fi network re-associating on wake reads as no network for a
    // second or two; the banner waits that out.
    expect(monitor.get()).toBe("ONLINE");

    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("OFFLINE");
    expect(seen).toEqual(["OFFLINE"]);
  });

  it("never shows OFFLINE for a link drop that recovers inside the grace", async () => {
    const { monitor, fetchMock, seen, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();

    link()?.({ isConnected: false, isInternetReachable: false });
    link()?.({ isConnected: true, isInternetReachable: true });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("ONLINE");
    expect(seen).toEqual([]);
  });

  it("does not show OFFLINE when /health answers after the grace — the link reading was wrong", async () => {
    // Android reports no network while it blocks the app's traffic, and
    // `expo-network` never re-emits when the block lifts.
    const { monitor, fetchMock, seen, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();

    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("ONLINE");
    expect(seen).toEqual([]);
  });

  it("does not count a probe the link drop interrupted", async () => {
    const { monitor, fetchMock, seen, link } = harness();
    let reject: (error: Error) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((_resolve, rejectProbe) => {
        reject = rejectProbe;
      }),
    );
    monitor.start();
    link()?.({ isConnected: false });
    reject(new Error("socket closed"));
    await settle();
    expect(seen).toEqual([]);
  });

  it("waits for the link-drop verdict instead of probing during the grace", async () => {
    const { monitor, fetchMock, link } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();
    fetchMock.mockClear();

    link()?.({ isConnected: false });
    await monitor.probeOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an unreachable internet as suspicion: it asks /health and does not count a failure", async () => {
    // The chat outbox reads this same monitor (#1072): a false offline would
    // disable check-in at the door, and a captive-portal-ish network reports
    // this while the API is perfectly reachable. `/health` settles it.
    const { monitor, fetchMock, seen, link } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();
    fetchMock.mockClear();

    link()?.({ isConnected: true, isInternetReachable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(monitor.get()).toBe("ONLINE");
    await settle();
    expect(seen).toEqual([]);
  });

  it("does not let a burst of unreachable readings add up to OFFLINE", async () => {
    // Android emits one event per capability change while a reconnected
    // network validates. Each used to count as a failure, so a reconnect
    // alone could reach three.
    const { monitor, fetchMock, link } = harness();
    let resolve: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolveProbe) => {
        resolve = resolveProbe;
      }),
    );
    monitor.start();
    for (let i = 0; i < 4; i += 1) {
      link()?.({ isConnected: true, isInternetReachable: false });
    }
    // One probe in flight answers all of them.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(monitor.get()).toBe("ONLINE");
    resolve(OK);
    await settle();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("finds its way back from a down link through /health, even with no link event", async () => {
    const { monitor, fetchMock, link, elapse } = harness();
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    monitor.start();
    await settle();
    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("OFFLINE");

    // A failed probe with the link down is not news about the API.
    await monitor.probeOnce();
    expect(monitor.get()).toBe("OFFLINE");

    fetchMock.mockResolvedValue(OK);
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("does not count a probe sent while the link was down once the link is back", async () => {
    const { monitor, fetchMock, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();

    // The confirmation probe hangs, as it does for a network Android is
    // still blocking for the app.
    let rejectStale: (error: Error) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectStale = reject;
      }),
    );
    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);

    fetchMock.mockResolvedValue(OK);
    link()?.({ isConnected: true, isInternetReachable: true });
    rejectStale(new Error("network unreachable"));
    await settle();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("asks /health about unreachable readings at most once per poll interval", async () => {
    // If `/health` fails fast while a reconnected network validates, a probe
    // per event would reach three failures in under a second.
    const { monitor, deps, fetchMock, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();
    fetchMock.mockClear();
    fetchMock.mockRejectedValue(new Error("network request failed"));

    for (let i = 0; i < 3; i += 1) {
      link()?.({ isConnected: true, isInternetReachable: false });
      await settle();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The first strike is confirmed by one retry before it counts.
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(monitor.get()).toBe("DEGRADED");

    // The next poll tick spends the interval's probe and re-arms suspicion.
    const tick = vi.mocked(deps.setInterval).mock.calls[0]?.[0] as () => void;
    tick();
    await settle();
    link()?.({ isConnected: true, isInternetReachable: false });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does nothing after stop(), even when a read started before it resolves late", async () => {
    let resolveRead: (state: { isConnected: boolean }) => void = () => {};
    const { monitor, deps, fetchMock, seen, pendingTimers } = harness({
      getState: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      ) as unknown as MonitorDeps["getState"],
    });
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    monitor.stop();
    fetchMock.mockClear();

    resolveRead({ isConnected: false });
    await settle();
    expect(pendingTimers()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(deps.clearInterval).toHaveBeenCalled();
  });

  it("stays OFFLINE when the link returns until /health answers, and then goes straight to ONLINE", async () => {
    const { monitor, fetchMock, link, elapse } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();

    fetchMock.mockRejectedValue(new Error("network unreachable"));
    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    // Two polls while the link is down.
    await monitor.probeOnce();
    await monitor.probeOnce();
    expect(monitor.get()).toBe("OFFLINE");

    // Back, but the API does not answer yet: still OFFLINE, not ONLINE over
    // a dead API.
    link()?.({ isConnected: true, isInternetReachable: true });
    expect(monitor.get()).toBe("OFFLINE");
    await settle();
    expect(monitor.get()).toBe("OFFLINE");

    // The first answer goes straight to ONLINE: the down-link polls left no
    // failures behind to show as "Slow connection".
    fetchMock.mockResolvedValue(OK);
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("reports the link half apart from /health, for chapter presence (#3917)", async () => {
    const { monitor, fetchMock, link, elapse } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await settle();
    elapse(CONFIRM_RETRY_MS);
    await settle();
    await monitor.probeOnce();
    await monitor.probeOnce();
    // Three failed probes: OFFLINE, but the link is up, so presence stays.
    expect(monitor.get()).toBe("OFFLINE");
    expect(monitor.linkDown()).toBe(false);

    // The link drops too. The state doesn't move, but a listener still
    // hears it, so presence can let go of its channel.
    const notified = vi.fn();
    monitor.subscribeLinkDown(notified);
    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("OFFLINE");
    expect(monitor.linkDown()).toBe(true);
    expect(notified).toHaveBeenCalled();

    // The link coming back clears it at once, while /health still fails:
    // presence must not wait on the API.
    link()?.({ isConnected: true, isInternetReachable: true });
    await settle();
    expect(monitor.linkDown()).toBe(false);
    expect(monitor.get()).toBe("OFFLINE");
    fetchMock.mockResolvedValue(OK);
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("clears a link drop on link-up even with no API configured (#3917)", async () => {
    const previous = process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    try {
      const { monitor, link, elapse } = harness();
      monitor.start();
      await settle();
      link()?.({ isConnected: false });
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.linkDown()).toBe(true);
      link()?.({ isConnected: true, isInternetReachable: true });
      expect(monitor.linkDown()).toBe(false);
    } finally {
      if (previous !== undefined) process.env.EXPO_PUBLIC_API_URL = previous;
    }
  });

  it("re-probes after a link blip inside the grace", async () => {
    const { monitor, fetchMock, link } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();
    fetchMock.mockClear();

    link()?.({ isConnected: false });
    link()?.({ isConnected: true, isInternetReachable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("lock and unlock", () => {
    it("ignores link events and probes while the app is in the background", async () => {
      const { monitor, fetchMock, seen, link, appState, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();

      appState("background");
      // Android blocks a backgrounded app's network: every request fails.
      fetchMock.mockClear();
      fetchMock.mockRejectedValue(new Error("network blocked"));
      await monitor.probeOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      // What Android reports for a network it is blocking for this app.
      link()?.({ isConnected: false, isInternetReachable: false });
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.get()).toBe("ONLINE");
      expect(seen).toEqual([]);
    });

    it("does not count a probe the OS cut off when the screen locked", async () => {
      const { monitor, fetchMock, seen, appState } = harness();
      let reject: (error: Error) => void = () => {};
      fetchMock.mockReturnValue(
        new Promise((_resolve, rejectProbe) => {
          reject = rejectProbe;
        }),
      );
      monitor.start();
      appState("background");
      reject(new Error("socket closed"));
      await settle();
      expect(seen).toEqual([]);
    });

    it("re-reads the link and probes as soon as the app is back in the foreground", async () => {
      const { monitor, deps, fetchMock, appState } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();
      vi.mocked(deps.getState).mockClear();
      fetchMock.mockClear();

      appState("background");
      appState("active");
      await settle();
      expect(deps.getState).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("clears an OFFLINE that a blocked network left behind, with no link event", async () => {
      // The shape of the 2026-11-04 report: a reading taken while Android was
      // blocking the app said no network, and nothing re-emitted afterwards.
      const { monitor, fetchMock, link, appState, elapse } = harness();
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      monitor.start();
      await settle();
      link()?.({ isConnected: false });
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.get()).toBe("OFFLINE");

      appState("background");
      fetchMock.mockResolvedValue(OK);
      appState("active");
      await settle();
      expect(monitor.get()).toBe("ONLINE");
    });

    it("still reaches OFFLINE within the grace when the network really went away while locked", async () => {
      const { monitor, deps, fetchMock, appState, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();

      appState("background");
      vi.mocked(deps.getState).mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      } as never);
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      appState("active");
      await settle();
      expect(monitor.get()).toBe("ONLINE");
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.get()).toBe("OFFLINE");
    });

    it("gives the first probe after unlock one retry before it shows the slow banner", async () => {
      // The first request after a long Doze can time out while the radio wakes.
      const { monitor, fetchMock, seen, appState, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();

      appState("background");
      fetchMock.mockRejectedValueOnce(new Error("timeout"));
      appState("active");
      await settle();
      expect(monitor.get()).toBe("ONLINE");

      elapse(CONFIRM_RETRY_MS);
      await settle();
      expect(monitor.get()).toBe("ONLINE");
      expect(seen).toEqual([]);
    });

    it("counts the retry when the API really is down after unlock", async () => {
      const { monitor, fetchMock, appState, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();

      appState("background");
      fetchMock.mockRejectedValue(new Error("timeout"));
      appState("active");
      await settle();
      elapse(CONFIRM_RETRY_MS);
      await settle();
      expect(monitor.get()).toBe("DEGRADED");
    });

    it("drops a pending link drop and a wake retry when the screen locks again", async () => {
      const { monitor, fetchMock, link, appState, pendingTimers } = harness();
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      await settle();
      link()?.({ isConnected: false });
      expect(pendingTimers()).toBe(1);
      appState("background");
      expect(pendingTimers()).toBe(0);
    });

    it("stops polling in the background and resumes in the foreground", async () => {
      const { monitor, deps, appState } = harness();
      monitor.start();
      appState("background");
      expect(deps.clearInterval).toHaveBeenCalledTimes(1);
      appState("active");
      expect(deps.setInterval).toHaveBeenCalledTimes(2);
    });

    it("treats iOS 'inactive' as still in the foreground", async () => {
      // Control Center and the notification shade: the app keeps running and
      // its network is not blocked.
      const { monitor, fetchMock, link, appState, elapse } = harness();
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      monitor.start();
      await settle();
      appState("inactive");
      link()?.({ isConnected: false });
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.get()).toBe("OFFLINE");
    });

    it("waits for the foreground when started in the background", async () => {
      const { monitor, fetchMock, appState } = harness(
        {},
        { appState: "background" },
      );
      fetchMock.mockResolvedValue(OK);
      monitor.start();
      expect(fetchMock).not.toHaveBeenCalled();
      appState("active");
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // #3747: TanStack's focus waits on this, so a resume-time retry goes out
  // after the network has answered, not into the socket iOS tore down.
  describe("the foreground verdict", () => {
    function deferredProbe(fetchMock: ReturnType<typeof vi.fn>) {
      let answer: (response: Response) => void = () => {};
      fetchMock.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      );
      return (response: Response) => answer(response);
    }

    it("is pending from background until the first foreground probe answers, and fires once", async () => {
      const { monitor, fetchMock, appState } = harness();
      fetchMock.mockResolvedValue(OK);
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      monitor.start();
      await settle();
      // A cold start is not a resume.
      expect(monitor.resumePending()).toBe(false);
      expect(settled).not.toHaveBeenCalled();

      appState("background");
      expect(monitor.resumePending()).toBe(true);
      const answer = deferredProbe(fetchMock);
      appState("active");
      await settle();
      expect(monitor.resumePending()).toBe(true);
      expect(settled).not.toHaveBeenCalled();

      answer(OK);
      await settle();
      expect(monitor.resumePending()).toBe(false);
      expect(settled).toHaveBeenCalledTimes(1);

      // Later probes are ordinary polls, not a second verdict.
      await monitor.probeOnce();
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("waits out a first failure's confirm retry, then settles on the counted result", async () => {
      const { monitor, fetchMock, appState, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      monitor.start();
      await settle();

      appState("background");
      fetchMock.mockRejectedValue(new Error("The network connection was lost."));
      appState("active");
      await settle();
      expect(settled).not.toHaveBeenCalled();

      elapse(CONFIRM_RETRY_MS);
      await settle();
      expect(settled).toHaveBeenCalledTimes(1);
      expect(monitor.get()).toBe("DEGRADED");
    });

    it("reports nothing for a return the app backgrounds again before the probe answers", async () => {
      const { monitor, fetchMock, appState } = harness();
      fetchMock.mockResolvedValue(OK);
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      monitor.start();
      await settle();

      appState("background");
      const answerStale = deferredProbe(fetchMock);
      appState("active");
      await settle();
      appState("background");
      answerStale(OK);
      await settle();
      expect(settled).not.toHaveBeenCalled();
      expect(monitor.resumePending()).toBe(true);

      appState("active");
      await settle();
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("settles on the probe that confirms a link drop seen during the return", async () => {
      const { monitor, fetchMock, appState, link, elapse } = harness();
      fetchMock.mockResolvedValue(OK);
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      monitor.start();
      await settle();

      appState("background");
      const answerWake = deferredProbe(fetchMock);
      appState("active");
      await settle();
      // The drop discards the wake probe; the grace's probe decides.
      link()?.({ isConnected: false, isInternetReachable: false });
      answerWake(OK);
      await settle();
      expect(settled).not.toHaveBeenCalled();

      fetchMock.mockRejectedValue(new Error("offline"));
      elapse(LINK_DOWN_GRACE_MS);
      await settle();
      expect(monitor.get()).toBe("OFFLINE");
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("settles at once with no API configured", async () => {
      delete process.env.EXPO_PUBLIC_API_URL;
      const { monitor, appState } = harness();
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      monitor.start();
      appState("background");
      appState("active");
      await settle();
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("releases a pending return on stop, and is never pending while stopped", async () => {
      const { monitor, fetchMock, appState } = harness();
      fetchMock.mockResolvedValue(OK);
      const settled = vi.fn();
      monitor.onResumeSettled(settled);
      expect(monitor.resumePending()).toBe(false);
      monitor.start();
      await settle();
      appState("background");
      monitor.stop();
      expect(settled).toHaveBeenCalledTimes(1);
      expect(monitor.resumePending()).toBe(false);
    });
  });

  it("degrades on a confirmed first failure and goes offline on the third", async () => {
    const { monitor, fetchMock, elapse } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    // `start()` fires the first probe itself, so it is the first of the three.
    monitor.start();
    await settle();
    // One failure is what a blip looks like: it is retried before it counts.
    expect(monitor.get()).toBe("ONLINE");
    elapse(CONFIRM_RETRY_MS);
    await settle();

    expect(monitor.get()).toBe("DEGRADED");
    await monitor.probeOnce();
    expect(monitor.get()).toBe("DEGRADED");
    await monitor.probeOnce();
    expect(monitor.get()).toBe("OFFLINE");
  });

  it("counts a non-ok response as a failure", async () => {
    const { monitor, fetchMock, elapse } = harness();
    fetchMock.mockResolvedValue(SERVER_ERROR);
    monitor.start();
    await settle();
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(monitor.get()).toBe("DEGRADED");
  });

  it("does not count a 429 as a failure — the API is up and throttling", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockResolvedValue(RATE_LIMITED);
    monitor.start();
    await Promise.resolve();
    expect(monitor.get()).toBe("ONLINE");
    await monitor.probeOnce();
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("clears a single failure the retry answers, with no banner", async () => {
    const { monitor, fetchMock, elapse, seen } = harness();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await settle();
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([]);
  });

  it("drops a pending retry once a probe gets through, and never counts a second first strike", async () => {
    const { monitor, fetchMock, elapse, seen } = harness();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    fetchMock.mockResolvedValueOnce(OK);
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await settle();
    // A probe gets through before the retry fires: the retry has nothing to
    // confirm, so it must not run and count the next failure as a strike.
    await monitor.probeOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([]);
  });

  it("lets a pending retry decide when another first strike fails before it", async () => {
    const { monitor, fetchMock, elapse, deps } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await settle();
    await monitor.probeOnce();
    // The second failure neither counts nor schedules a second retry.
    expect(monitor.get()).toBe("ONLINE");
    expect(deps.setTimeout).toHaveBeenCalledTimes(1);
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(monitor.get()).toBe("DEGRADED");
  });

  it("recovers to ONLINE on the first success", async () => {
    const { monitor, fetchMock, elapse } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await settle();
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(monitor.get()).toBe("DEGRADED");

    fetchMock.mockResolvedValue(OK);
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("does not reset the failure count on a link event; a successful probe does", async () => {
    const { monitor, fetchMock, link, elapse } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await settle();
    elapse(CONFIRM_RETRY_MS);
    await settle();
    expect(monitor.get()).toBe("DEGRADED");

    // `expo-network` fires on every path update — a cell handoff, a VPN toggle,
    // a Wi-Fi↔LTE switch. Resetting on those (or on a genuine reconnect)
    // meant a moving device could never accumulate three failures, or would
    // flash ONLINE while `/health` was still dead.
    link()?.({ isConnected: true, isInternetReachable: true });
    expect(monitor.get()).toBe("DEGRADED");

    link()?.({ isConnected: false });
    elapse(LINK_DOWN_GRACE_MS);
    await settle();
    expect(monitor.get()).toBe("OFFLINE");

    fetchMock.mockResolvedValue(OK);
    link()?.({ isConnected: true, isInternetReachable: true });
    // A link is not a reachable API — stay off ONLINE until the probe lands.
    expect(monitor.get()).not.toBe("ONLINE");
    await Promise.resolve();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("stays ONLINE with no API configured, rather than painting a banner over a missing env var", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    const { monitor, fetchMock } = harness();
    monitor.start();
    await monitor.probeOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("only notifies on a change, not on every probe", async () => {
    const { monitor, fetchMock, seen } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    await monitor.probeOnce();
    await monitor.probeOnce();
    expect(seen).toEqual([]);
  });

  it("start is idempotent, so mounting the runtime twice does not double-poll", () => {
    const { monitor, deps } = harness();
    monitor.start();
    monitor.start();
    expect(deps.setInterval).toHaveBeenCalledTimes(1);
    expect(deps.addListener).toHaveBeenCalledTimes(1);
  });

  it("aborts a probe that outlives its timeout", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      // The 5s AbortController is what stops a hung socket from holding the
      // poll open past its own interval.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(OK);
    });
    monitor.start();
    await Promise.resolve();
    fetchMock.mockClear();
    await monitor.probeOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
