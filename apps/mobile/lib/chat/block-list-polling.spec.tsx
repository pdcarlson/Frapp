/** @vitest-environment jsdom */
/**
 * A block list whose endpoint is down must not become a background poll
 * (#2315 defect 6, acceptance criterion 4).
 *
 * TanStack v5 leaves a failed query at `status: "error"` indefinitely, so an
 * error-only `refetchInterval` — the obvious way to "keep retrying" — turns
 * into a permanent fixed-rate poll for every member, all session, against an
 * endpoint that is already failing. `useBlockedUserIds` sets none, and the
 * safety notice's Retry is the member's way back.
 *
 * Driven through the real hook on **this app's own** `QueryClient`
 * (`lib/query-client.ts`), not a test client built from it: an interval or an
 * unbounded retry added to the hook, to the client's defaults, or as a
 * per-key default (`setQueryDefaults`) on that client fails here.
 */

import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider, useBlockedUserIds } from "@repo/hooks";
import { queryClient as appQueryClient } from "@/lib/query-client";

const HOUR_MS = 60 * 60_000;

const mockGet = vi.fn(async () => ({
  error: { message: "Service Unavailable" },
  response: new Response(null, { status: 503 }),
}));

function renderBlockList() {
  const queryClient = appQueryClient;
  const client = { GET: mockGet };
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <FrappClientProvider
        client={client as unknown as ReturnType<typeof createFrappClient>}
        chapterId="chapter-1"
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
  }
  Wrapper.displayName = "BlockListWrapper";
  return renderHook(() => useBlockedUserIds(), { wrapper: Wrapper });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockGet.mockClear();
});

afterEach(() => {
  // The singleton outlives this file's tests; nothing may leak between them.
  appQueryClient.clear();
  vi.useRealTimers();
});

describe("useBlockedUserIds against an endpoint that stays down", () => {
  it("reads a bounded number of times, then waits for a reason instead of polling", async () => {
    const { result } = renderBlockList();

    // The first read and the app's own retry budget play out in seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.status).toBe("unavailable");
    const settled = mockGet.mock.calls.length;
    expect(settled).toBeGreaterThanOrEqual(1);
    expect(settled).toBeLessThanOrEqual(4);

    // An hour on the thread with nothing to prompt a read: not one more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });
    expect(mockGet).toHaveBeenCalledTimes(settled);
  });

  it("the member's Retry reads again, then goes quiet", async () => {
    const { result } = renderBlockList();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const settled = mockGet.mock.calls.length;

    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGet.mock.calls.length).toBeGreaterThan(settled);

    const afterRetry = mockGet.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });
    // The retry's own backoff may add the app's retry budget, then silence.
    expect(mockGet.mock.calls.length - afterRetry).toBeLessThanOrEqual(3);
    expect(result.current.status).toBe("unavailable");
  });
});
