/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  CHECK_IN_TOKEN_FALLBACK_POLL_MS,
  CHECK_IN_TOKEN_MIN_POLL_MS,
  checkInTokenRefetchMs,
  useAttendance,
  useCheckIn,
  useMintCheckInToken,
} from "./use-attendance";
import { FrappClientProvider } from "./use-frapp-client";

describe("useAttendance", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "AttendanceHookWrapper";
    return Wrapper;
  };

  it("fetches attendance data for the provided event id", async () => {
    const mockAttendance = [
      {
        id: "attendance-1",
        user_id: "user-1",
        status: "PRESENT",
      },
    ];

    const mockGet = vi.fn().mockResolvedValue({
      data: mockAttendance,
      error: null,
    });

    const mockClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useAttendance("event-123"), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/events/{eventId}/attendance", {
      params: { path: { eventId: "event-123" } },
    });
    expect(result.current.data).toEqual(mockAttendance);
  });

  it("surfaces an error when attendance request fails", async () => {
    const mockError = new Error("Failed to fetch attendance");
    const mockGet = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const mockClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useAttendance("event-999"), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(mockError);
  });

  it("does not request attendance when the event id is empty", async () => {
    const mockGet = vi.fn();
    const mockClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useAttendance(""), {
      wrapper: createWrapper(mockClient),
    });

    // Flush pending microtasks, then assert synchronously. Wrapping a negative
    // assertion in `waitFor` would resolve on the first poll and could never
    // observe a later call — it passes even if the request fires a tick after
    // mount.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });

  /**
   * s22's "N checked in" (#20 of the 2026-11 polish pass). Nothing pushes a
   * roster change, so a host screen that never re-read it showed the count
   * from when it opened for the whole meeting. The query's own option is read
   * off the cache rather than by waiting out a real interval.
   */
  describe("refetchInterval", () => {
    const optionsOf = (eventId: string) =>
      queryClient
        .getQueryCache()
        .find({ queryKey: ["attendance", eventId], exact: true })?.options as
        | { refetchInterval?: unknown }
        | undefined;

    it("polls at the interval a caller passes", async () => {
      const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
      renderHook(
        () => useAttendance("event-123", { refetchInterval: 10_000 }),
        { wrapper: createWrapper({ GET: mockGet }) },
      );

      await waitFor(() => expect(mockGet).toHaveBeenCalled());
      expect(optionsOf("event-123")?.refetchInterval).toBe(10_000);
    });

    it("does not poll by default, so web's roster and chat card are unchanged", async () => {
      const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
      renderHook(() => useAttendance("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });

      await waitFor(() => expect(mockGet).toHaveBeenCalled());
      expect(optionsOf("event-123")?.refetchInterval).toBe(false);
    });

    it("re-reads the roster on each tick", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const mockGet = vi
          .fn()
          .mockResolvedValueOnce({ data: [{ status: "PRESENT" }], error: null })
          .mockResolvedValue({
            data: [{ status: "PRESENT" }, { status: "LATE" }],
            error: null,
          });
        const { result } = renderHook(
          () => useAttendance("event-123", { refetchInterval: 10_000 }),
          { wrapper: createWrapper({ GET: mockGet }) },
        );

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        await waitFor(() => expect(result.current.data).toHaveLength(2));
        expect(mockGet).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/**
 * s22's rotating code. The screen measures everything on the phone's own clock
 * from when the request was sent, and it is asked for again when it rotates,
 * so a code on display is replaced as its window opens rather than up to a
 * poll interval later.
 */
describe("useMintCheckInToken", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "MintCheckInTokenWrapper";
    return Wrapper;
  };

  const MINTED = {
    token: "signed",
    manualCode: "4KQ-88",
    qrPayload: "frapp-checkin:v1:event-123:signed",
    expiresAt: "2026-11-05T12:00:30.000Z",
  };

  it("stamps the request's start, which is never later than the mint", async () => {
    let sentAt = 0;
    const mockGet = vi.fn().mockImplementation(async () => {
      sentAt = Date.now();
      // The trip back: a stamp taken on arrival would be this much later.
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { data: { ...MINTED, rotatesInMs: 20_000 }, error: null };
    });
    const before = Date.now();
    const { result } = renderHook(() => useMintCheckInToken("event-123"), {
      wrapper: createWrapper({ GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.response).toEqual({
      ...MINTED,
      rotatesInMs: 20_000,
    });
    expect(result.current.data?.requestedAt).toBeGreaterThanOrEqual(before);
    expect(result.current.data?.requestedAt).toBeLessThanOrEqual(sentAt);
  });

  it("asks for the next code when this one rotates, not a poll later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mockGet = vi
        .fn()
        .mockResolvedValue({
          data: { ...MINTED, rotatesInMs: 7_000 },
          error: null,
        });
      renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      // Before the rotation: the code on screen is the current one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Just past it (7s, plus the half-second slack).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("checkInTokenRefetchMs", () => {
    const result = (rotatesInMs: unknown, requestedAt = 1_000_000) => ({
      response: { ...MINTED, rotatesInMs },
      requestedAt,
    });

    it("waits until just after the rotation, counted from the request's start", () => {
      expect(checkInTokenRefetchMs(result(20_000), false, 1_005_000)).toBe(
        15_500,
      );
    });

    it("polls on the fallback with nothing to time from", () => {
      expect(checkInTokenRefetchMs(undefined, false, 0)).toBe(
        CHECK_IN_TOKEN_FALLBACK_POLL_MS,
      );
      expect(checkInTokenRefetchMs(result(undefined), false, 0)).toBe(
        CHECK_IN_TOKEN_FALLBACK_POLL_MS,
      );
      // A failed refetch keeps the old data, whose rotation is long past;
      // timing off it would retry every second.
      expect(checkInTokenRefetchMs(result(20_000), true, 9_999_999)).toBe(
        CHECK_IN_TOKEN_FALLBACK_POLL_MS,
      );
    });

    it("never asks again sooner than the minimum", () => {
      expect(checkInTokenRefetchMs(result(20_000), false, 5_000_000)).toBe(
        CHECK_IN_TOKEN_MIN_POLL_MS,
      );
    });
  });
});

describe("useCheckIn", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "CheckInHookWrapper";
    return Wrapper;
  };

  it("calls the check-in endpoint and invalidates attendance query on success", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const mockClient = {
      POST: mockPost,
    };

    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper(mockClient),
    });

    await expect(
      result.current.mutateAsync({ eventId: "event-123" }),
    ).resolves.toBeDefined();

    expect(mockPost).toHaveBeenCalledWith("/v1/events/{eventId}/attendance/check-in", {
      params: { path: { eventId: "event-123" } },
      body: {},
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["attendance", "event-123"],
    });
  });

  it("surfaces an error when check-in request fails", async () => {
    const mockError = new Error("Failed to check in");
    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const mockClient = {
      POST: mockPost,
    };

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper(mockClient),
    });

    await expect(
      result.current.mutateAsync({ eventId: "event-999" }),
    ).rejects.toThrowError(mockError);
  });

  it("ensures queryClient.invalidateQueries is called on success", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const mockClient = {
      POST: mockPost,
    };

    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper(mockClient),
    });

    await expect(
      result.current.mutateAsync({ eventId: "event-123" }),
    ).resolves.toBeDefined();

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["attendance", "event-123"],
    });
  });

  // The scanner path (s18): the token and the fix travel in the body, and the
  // event id stays in the path. Pinning the split because a payload that
  // silently dropped `token` would still check members in — just without the
  // code ever having been verified.
  it("sends the scanner token and coordinates as the request body", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    await result.current.mutateAsync({
      eventId: "event-123",
      token: "signed-token",
      lat: 42.7298,
      lng: -73.678,
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/events/{eventId}/attendance/check-in", {
      params: { path: { eventId: "event-123" } },
      body: { token: "signed-token", lat: 42.7298, lng: -73.678 },
    });
  });

});
