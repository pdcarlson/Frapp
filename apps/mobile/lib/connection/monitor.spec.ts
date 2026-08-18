import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnectionMonitor,
  healthUrl,
  type MonitorDeps,
} from "./monitor";
import type { ConnectionState } from "./state";

type LinkListener = (state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}) => void;

function harness(overrides: Partial<MonitorDeps> = {}) {
  let listener: LinkListener | null = null;
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
    ...overrides,
  } as unknown as MonitorDeps;

  const monitor = createConnectionMonitor(deps);
  const seen: ConnectionState[] = [];
  monitor.subscribe((state) => seen.push(state));
  return { monitor, deps, fetchMock, seen, link: () => listener };
}

const OK = { ok: true } as Response;
const SERVER_ERROR = { ok: false } as Response;

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

  it("goes OFFLINE the moment the link drops", async () => {
    const { monitor, seen, link } = harness();
    monitor.start();
    link()?.({ isConnected: false, isInternetReachable: false });
    expect(monitor.get()).toBe("OFFLINE");
    expect(seen).toEqual(["OFFLINE"]);
  });

  it("treats an unreachable internet as suspicion, not proof", () => {
    // `isOfflineFromExpoState` folds this into "offline" for the chat outbox,
    // where a false offline only means "queue instead of send". Here the value
    // gates writes, so folding it in would disable the check-in field at the
    // door for a captive-portal-ish network whose API is perfectly reachable —
    // and with no recovery, since a down link also suppresses the probe. One
    // failure's worth of suspicion, and `/health` settles it.
    const { monitor, link } = harness();
    monitor.start();
    link()?.({ isConnected: true, isInternetReachable: false });
    expect(monitor.get()).toBe("DEGRADED");
  });

  it("lets a successful probe overrule an unreachable-internet reading", async () => {
    const { monitor, fetchMock, link } = harness();
    fetchMock.mockResolvedValue(OK);
    monitor.start();
    link()?.({ isConnected: true, isInternetReachable: false });
    expect(monitor.get()).toBe("DEGRADED");
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("does not probe while the link is down", async () => {
    const { monitor, fetchMock, link } = harness();
    monitor.start();
    // Let the start probe and the initial `getState()` read settle first, so
    // this asserts on the steady state rather than on boot ordering.
    await Promise.resolve();
    await Promise.resolve();
    fetchMock.mockClear();
    link()?.({ isConnected: false });
    await monitor.probeOnce();
    // The answer is already known; a probe would burn a request and up to 5s
    // to reach it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades on the first failure and goes offline on the third", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    // `start()` fires the first probe itself, so it is the first of the three.
    monitor.start();
    await Promise.resolve();

    expect(monitor.get()).toBe("DEGRADED");
    await monitor.probeOnce();
    expect(monitor.get()).toBe("DEGRADED");
    await monitor.probeOnce();
    expect(monitor.get()).toBe("OFFLINE");
  });

  it("counts a non-ok response as a failure", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockResolvedValue(SERVER_ERROR);
    monitor.start();
    await monitor.probeOnce();
    expect(monitor.get()).toBe("DEGRADED");
  });

  it("recovers to ONLINE on the first success", async () => {
    const { monitor, fetchMock } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await monitor.probeOnce();
    expect(monitor.get()).toBe("DEGRADED");

    fetchMock.mockResolvedValue(OK);
    await monitor.probeOnce();
    expect(monitor.get()).toBe("ONLINE");
  });

  it("clears accumulated failures only on a real offline → online transition", async () => {
    const { monitor, fetchMock, link } = harness();
    fetchMock.mockRejectedValue(new Error("timeout"));
    monitor.start();
    await monitor.probeOnce();
    expect(monitor.get()).toBe("DEGRADED");

    // `expo-network` fires on every path update — a cell handoff, a VPN toggle,
    // a Wi-Fi↔LTE switch. Resetting on each of those meant a moving device
    // could never accumulate three failures, so an API outage never reached the
    // banner at all.
    link()?.({ isConnected: true, isInternetReachable: true });
    expect(monitor.get()).toBe("DEGRADED");

    link()?.({ isConnected: false });
    expect(monitor.get()).toBe("OFFLINE");
    link()?.({ isConnected: true, isInternetReachable: true });
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
