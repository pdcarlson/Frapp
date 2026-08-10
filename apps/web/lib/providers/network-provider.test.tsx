import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NetworkProvider } from "./network-provider";

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
 */
describe("NetworkProvider health check URL", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
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
      await vi.advanceTimersByTimeAsync(30_000);
    });
    return fetchMock.mock.calls[0]?.[0];
  }

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
