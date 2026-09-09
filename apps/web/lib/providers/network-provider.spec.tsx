import { render, act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NetworkProvider, useNetwork } from "./network-provider";

/**
 * The health poll is the one consumer of NEXT_PUBLIC_API_URL that needs the
 * bare origin for a reason unrelated to the SDK: `/health` is the single route
 * that does not live under `/v1`.
 *
 * It used to carry its own inline `/v1` strip, which meant the repo held two
 * consumers with opposite assumptions about one variable — and because this
 * one compensated, the health check kept reporting ONLINE while every data
 * request 404'd on a doubled `/v1` (#785). These tests pin the URL it actually
 * polls, which nothing covered before: the two suites that reference this
 * module both `vi.mock` it wholesale.
 *
 * The call-site cases (#512) are the ones a prior attempt's pure-function
 * suite never had: inverting `!linkOnline` at the provider used to pass the
 * whole web suite.
 */
describe("NetworkProvider health check URL", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function urlPolledOnce() {
    render(
      <NetworkProvider>
        <div />
      </NetworkProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    return fetchMock.mock.calls[0]?.[0];
  }

  it("polls on mount, not only on the first interval tick", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
    await urlPolledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls the bare origin's /health when the env var carries a stale /v1", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001/v1");
    // Not http://localhost:3001/v1/health — that route does not exist.
    expect(await urlPolledOnce()).toBe("http://localhost:3001/health");
  });

  it("polls /health off a correctly configured bare origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
    expect(await urlPolledOnce()).toBe("http://localhost:3001/health");
  });

  it("tolerates a trailing slash without doubling the separator", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001/");
    expect(await urlPolledOnce()).toBe("http://localhost:3001/health");
  });

  it("does not poll at all when no API URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    await urlPolledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function Probe() {
  const network = useNetwork();
  return (
    <div>
      <span data-testid="state">{network.state}</span>
      <span data-testid="offline">{String(network.isOffline)}</span>
      <span data-testid="degraded">{String(network.isDegraded)}</span>
      <span data-testid="link">{String(network.linkOnline)}</span>
      <button type="button" onClick={() => void network.probeOnce()}>
        probe
      </button>
    </div>
  );
}

describe("NetworkProvider connection state (#512)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function renderProbe() {
    render(
      <NetworkProvider>
        <Probe />
      </NetworkProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("is ONLINE when the mount probe succeeds", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await renderProbe();
    expect(screen.getByTestId("state")).toHaveTextContent("ONLINE");
    expect(screen.getByTestId("offline")).toHaveTextContent("false");
  });

  it("is DEGRADED after one failed probe with the link still up", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await renderProbe();
    expect(screen.getByTestId("state")).toHaveTextContent("DEGRADED");
    expect(screen.getByTestId("offline")).toHaveTextContent("false");
    expect(screen.getByTestId("link")).toHaveTextContent("true");
  });

  it("sets isOffline after three failed probes with navigator.onLine still true", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await renderProbe();
    expect(screen.getByTestId("offline")).toHaveTextContent("false");

    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("OFFLINE");
    expect(screen.getByTestId("offline")).toHaveTextContent("true");
    expect(screen.getByTestId("link")).toHaveTextContent("true");
  });

  it("does not count a 429 as a failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await renderProbe();
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("ONLINE");
    expect(screen.getByTestId("offline")).toHaveTextContent("false");
  });

  it("counts a 503 as a failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await renderProbe();
    expect(screen.getByTestId("state")).toHaveTextContent("DEGRADED");
    expect(screen.getByTestId("offline")).toHaveTextContent("false");
  });

  it("restores ONLINE on the first successful probe after offline", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await renderProbe();
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("offline")).toHaveTextContent("true");

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("ONLINE");
    expect(screen.getByTestId("offline")).toHaveTextContent("false");
  });

  it("probes again on the browser online event instead of blindly resetting", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await renderProbe();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("state")).toHaveTextContent("DEGRADED");
  });

  it("does not apply a stale probe result after a newer one succeeds", async () => {
    let finishFirst!: (value: { ok: boolean; status: number }) => void;
    const first = new Promise<{ ok: boolean; status: number }>((resolve) => {
      finishFirst = resolve;
    });
    fetchMock.mockImplementationOnce(() => first);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await renderProbe();
    await act(async () => {
      screen.getByRole("button", { name: "probe" }).click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("ONLINE");

    await act(async () => {
      finishFirst({ ok: false, status: 503 });
      await Promise.resolve();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("ONLINE");
  });
});
