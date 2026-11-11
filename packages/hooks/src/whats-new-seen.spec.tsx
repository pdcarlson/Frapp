// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import {
  WHATS_NEW_ACCOUNT_WAIT_MS,
  useAccountWhatsNewSeen,
  useRecordWhatsNewSeen,
  whatsNewSeenQueryKey,
} from "./whats-new-seen";

const wrapperFor = (queryClient: QueryClient, client: unknown) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as ReturnType<typeof import("@repo/api-sdk").createFrappClient>
      }
      chapterId={null}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
};

describe("What's new on the account (#4043)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("settles with the account's version, or null when none is recorded", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({ data: { seen_version: null }, error: undefined }),
    };
    const { result } = renderHook(() => useAccountWhatsNewSeen(), {
      wrapper: wrapperFor(queryClient, client),
    });
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.seen).toBeNull();
    expect(client.GET).toHaveBeenCalledWith("/v1/users/me/whats-new");
  });

  it("settles as unknown when the read fails, so the device goes by its own marker", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({ data: undefined, error: { status: 500 } }),
    };
    const { result } = renderHook(() => useAccountWhatsNewSeen(), {
      wrapper: wrapperFor(queryClient, client),
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.seen).toBeUndefined();
  });

  it("stops waiting on a read that hangs", () => {
    vi.useFakeTimers();
    const client = { GET: vi.fn(() => new Promise(() => {})) };
    const { result } = renderHook(() => useAccountWhatsNewSeen(), {
      wrapper: wrapperFor(queryClient, client),
    });
    expect(result.current.settled).toBe(false);
    act(() => {
      vi.advanceTimersByTime(WHATS_NEW_ACCOUNT_WAIT_MS);
    });
    expect(result.current.settled).toBe(true);
    expect(result.current.seen).toBeUndefined();
  });

  it("records a newer version and caches the answer, but doesn't resend one the account holds", async () => {
    const client = {
      PUT: vi
        .fn()
        .mockResolvedValue({ data: { seen_version: "2026-11-10#6" }, error: undefined }),
    };
    const { result } = renderHook(() => useRecordWhatsNewSeen(), {
      wrapper: wrapperFor(queryClient, client),
    });
    await act(async () => {
      await result.current.mutateAsync("2026-11-10#6");
    });
    expect(client.PUT).toHaveBeenCalledWith("/v1/users/me/whats-new", {
      body: { seen_version: "2026-11-10#6" },
    });
    expect(queryClient.getQueryData(whatsNewSeenQueryKey())).toEqual({
      seen_version: "2026-11-10#6",
    });

    await act(async () => {
      await result.current.mutateAsync("2026-11-10#6");
      await result.current.mutateAsync("2026-11-09#9");
    });
    expect(client.PUT).toHaveBeenCalledTimes(1);
  });
});
