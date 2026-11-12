/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
  CHECK_IN_TOKEN_FALLBACK_POLL_MS,
  CHECK_IN_TOKEN_MIN_POLL_MS,
  checkInTokenRefetchMs,
  deviceNow,
  elapsedSince,
  isCheckInCodesUnconfigured,
  isTransientCheckInFailure,
  useAttendance,
  useAutoAbsent,
  useCheckIn,
  useMintCheckInToken,
  useMyAttendance,
  useUpdateAttendanceStatus,
  selectOwnAttendance,
} from "./use-attendance";
import { FrappClientProvider } from "./use-frapp-client";

/** A 2xx, as openapi-fetch resolves it. */
const answered = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: { status, ok: true },
});

/** A refusal, as openapi-fetch resolves it: the API's error body. */
const refusedWith = (error: { statusCode: number; message?: unknown }) => ({
  data: undefined,
  error,
  response: { status: error.statusCode, ok: false },
});

/**
 * openapi-fetch 0.17's shape for a non-2xx with an empty body, such as an
 * edge's 502 during a deploy: `error: undefined` when the response says
 * `Content-Length: 0`, `""` otherwise. Both are falsy, so only the status
 * tells it from a success.
 */
const emptyBodied = (status: number, error: undefined | "" = undefined) => ({
  data: undefined,
  error,
  response: { status, ok: false },
});

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

    const mockGet = vi.fn().mockResolvedValue(answered(mockAttendance));

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
    const mockError = { statusCode: 404, message: "Event not found" };
    const mockGet = vi.fn().mockResolvedValue(refusedWith(mockError));

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

  it("fails on an empty-bodied 5xx rather than reading a roster of nothing", async () => {
    for (const error of [undefined, ""] as const) {
      queryClient.clear();
      const mockGet = vi.fn().mockResolvedValue(emptyBodied(502, error));
      const { result, unmount } = renderHook(() => useAttendance("event-1"), {
        wrapper: createWrapper({ GET: mockGet }),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toMatchObject({ statusCode: 502 });
      unmount();
    }
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
   * s22's "N checked in". Nothing pushes a roster change, so a host screen
   * that never re-read it showed the count from when it opened for the whole
   * meeting. The query's own option is read off the cache rather than by
   * waiting out a real interval.
   */
  describe("refetchInterval", () => {
    const optionsOf = (eventId: string) =>
      queryClient
        .getQueryCache()
        .find({ queryKey: ["attendance", eventId], exact: true })?.options as
        | { refetchInterval?: unknown }
        | undefined;

    it("polls at the interval a caller passes", async () => {
      const mockGet = vi.fn().mockResolvedValue(answered([]));
      renderHook(
        () => useAttendance("event-123", { refetchInterval: 10_000 }),
        { wrapper: createWrapper({ GET: mockGet }) },
      );

      await waitFor(() => expect(mockGet).toHaveBeenCalled());
      expect(optionsOf("event-123")?.refetchInterval).toBe(10_000);
    });

    it("does not poll by default, so web's roster and chat card are unchanged", async () => {
      const mockGet = vi.fn().mockResolvedValue(answered([]));
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
          .mockResolvedValueOnce(answered([{ status: "PRESENT" }]))
          .mockResolvedValue(
            answered([{ status: "PRESENT" }, { status: "LATE" }]),
          );
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
 * s22's rotating code. The screen measures everything on the phone's own
 * clocks from when the request was sent, and it is asked for again when it
 * rotates, so a code on display is replaced as its window opens rather than up
 * to a poll interval later.
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

  /** A mint whose window has `rotatesInMs` left, as the GET resolves it. */
  const minted = (rotatesInMs: number) => answered({ ...MINTED, rotatesInMs });

  /** Runs `test` on fake timers, which fake both of the device's clocks. */
  async function withFakeTimers(test: () => Promise<void>) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await test();
    } finally {
      vi.useRealTimers();
    }
  }

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("stamps the request's start on both clocks, which is never later than the mint", async () => {
    let sentAt = deviceNow();
    const mockGet = vi.fn().mockImplementation(async () => {
      sentAt = deviceNow();
      // The trip back: a stamp taken on arrival would be this much later.
      await new Promise((resolve) => setTimeout(resolve, 25));
      return minted(20_000);
    });
    const before = deviceNow();
    const { result } = renderHook(() => useMintCheckInToken("event-123"), {
      wrapper: createWrapper({ GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.response).toEqual({
      ...MINTED,
      rotatesInMs: 20_000,
    });
    const requestedAt = result.current.data!.requestedAt;
    expect(requestedAt.wall).toBeGreaterThanOrEqual(before.wall);
    expect(requestedAt.wall).toBeLessThanOrEqual(sentAt.wall);
    expect(requestedAt.monotonic).toBeGreaterThanOrEqual(before.monotonic);
    expect(requestedAt.monotonic).toBeLessThanOrEqual(sentAt.monotonic);
  });

  it("asks for the next code when this one rotates, not a poll later", () =>
    withFakeTimers(async () => {
      const mockGet = vi.fn().mockResolvedValue(minted(7_000));
      renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      // Before the rotation: the code on screen is the current one.
      await advance(6_000);
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Just past it (7s, plus the half-second slack).
      await advance(2_000);
      expect(mockGet).toHaveBeenCalledTimes(2);
    }));

  it("keeps to the rotation when the wall clock steps back after the mint", () =>
    // A network time correction, or a manual change. Timed off the wall clock
    // alone, the next request would wait two minutes longer.
    withFakeTimers(async () => {
      const mockGet = vi.fn().mockResolvedValue(minted(7_000));
      const { rerender } = renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      await advance(3_000);
      vi.setSystemTime(Date.now() - 120_000);
      // The host screen re-renders twice a second, and each render re-reads
      // the interval.
      rerender();
      await advance(5_000);
      expect(mockGet).toHaveBeenCalledTimes(2);
    }));

  it("asks at once when the phone slept past the rotation", () =>
    // Android's monotonic clock stops while the phone sleeps; the wall clock
    // doesn't. Timed off the monotonic clock alone, the code that died while
    // the screen was off would wait out its whole window again.
    withFakeTimers(async () => {
      const mockGet = vi.fn().mockResolvedValue(minted(7_000));
      const { rerender } = renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      vi.setSystemTime(Date.now() + 120_000);
      rerender();
      await advance(1_500);
      expect(mockGet).toHaveBeenCalledTimes(2);
    }));

  it("asks again on the fallback poll after a refetch that may go through next time", () =>
    // A failed refetch keeps the last code, whose rotation is past. Timed off
    // it, the screen would ask every second for as long as the venue's
    // network is down.
    withFakeTimers(async () => {
      const mockGet = vi
        .fn()
        .mockResolvedValueOnce(minted(7_000))
        .mockResolvedValueOnce(
          refusedWith({ statusCode: 502, message: "Bad Gateway" }),
        )
        .mockResolvedValue(minted(30_000));
      const { result } = renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      await advance(7_600);
      expect(mockGet).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(result.current.isError).toBe(true));

      await advance(5_000);
      expect(mockGet).toHaveBeenCalledTimes(2);

      await advance(5_500);
      expect(mockGet).toHaveBeenCalledTimes(3);
    }));

  it("asks again on the fallback poll after a 401, and the renewed sign-in's answer lands", () =>
    // The phone slept past the access token's expiry. On waking, the focus
    // refetch beats the token's renewal and goes out with the expired token;
    // the renewed one then lands without asking this query again.
    withFakeTimers(async () => {
      const mockGet = vi
        .fn()
        .mockResolvedValueOnce(minted(7_000))
        .mockResolvedValueOnce(
          refusedWith({ statusCode: 401, message: "Unauthorized" }),
        )
        .mockResolvedValue(minted(30_000));
      const { result } = renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

      await advance(7_600);
      expect(mockGet).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toMatchObject({ statusCode: 401 });

      await advance(10_500);
      expect(mockGet).toHaveBeenCalledTimes(3);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.response).toMatchObject({
        rotatesInMs: 30_000,
      });
    }));

  it("reads an empty-bodied 5xx as the failure it is", () =>
    withFakeTimers(async () => {
      for (const error of [undefined, ""] as const) {
        queryClient.clear();
        const mockGet = vi
          .fn()
          .mockResolvedValueOnce(emptyBodied(502, error))
          .mockResolvedValue(minted(30_000));
        const { result, unmount } = renderHook(
          () => useMintCheckInToken("event-123"),
          { wrapper: createWrapper({ GET: mockGet }) },
        );
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toMatchObject({ statusCode: 502 });

        // Transient, so the fallback poll asks again.
        await advance(10_500);
        expect(mockGet).toHaveBeenCalledTimes(2);
        unmount();
      }
    }));

  it("keeps the last code through a rotation refetch answered by an empty-bodied 5xx", () =>
    // That code still redeems for a window, and s22 goes on drawing it. Read
    // as a success, the empty answer would replace it with no code at all.
    withFakeTimers(async () => {
      const mockGet = vi
        .fn()
        .mockResolvedValueOnce(minted(7_000))
        .mockResolvedValue(emptyBodied(502));
      const { result } = renderHook(() => useMintCheckInToken("event-123"), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await advance(7_600);
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result.current.data?.response).toEqual({
        ...MINTED,
        rotatesInMs: 7_000,
      });
    }));

  it("stops asking after a refusal that asking again won't fix", () =>
    withFakeTimers(async () => {
      for (const refusal of [
        { statusCode: 403, message: "Forbidden" },
        { statusCode: 404, message: "Event not found" },
        { statusCode: 503, message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE },
      ]) {
        queryClient.clear();
        const mockGet = vi.fn().mockResolvedValue(refusedWith(refusal));
        const { result, unmount } = renderHook(
          () => useMintCheckInToken("event-123"),
          { wrapper: createWrapper({ GET: mockGet }) },
        );
        await waitFor(() => expect(result.current.isError).toBe(true));

        await advance(35_000);
        expect(mockGet).toHaveBeenCalledTimes(1);
        unmount();
      }
    }));

  describe("checkInTokenRefetchMs", () => {
    const AT = { monotonic: 50_000, wall: 1_000_000 };
    /** `ms` after `AT` on both clocks. */
    const after = (ms: number) => ({
      monotonic: AT.monotonic + ms,
      wall: AT.wall + ms,
    });
    const success = (rotatesInMs: unknown) => ({
      status: "success" as const,
      error: null,
      data: { response: { ...MINTED, rotatesInMs }, requestedAt: AT },
    });
    const failed = (error: unknown) => ({
      ...success(20_000),
      status: "error" as const,
      error,
    });

    it("waits until just after the rotation, counted from the request's start", () => {
      expect(checkInTokenRefetchMs(success(20_000), after(5_000))).toBe(15_500);
    });

    it("counts the larger of the two clocks' readings", () => {
      // The wall clock stepped back two minutes: the monotonic one still
      // reads 5s.
      expect(
        checkInTokenRefetchMs(success(20_000), {
          monotonic: AT.monotonic + 5_000,
          wall: AT.wall - 115_000,
        }),
      ).toBe(15_500);
      // The phone slept for two minutes: the wall clock still reads them.
      expect(
        checkInTokenRefetchMs(success(20_000), {
          monotonic: AT.monotonic + 1_000,
          wall: AT.wall + 120_000,
        }),
      ).toBe(CHECK_IN_TOKEN_MIN_POLL_MS);
    });

    it("polls on the fallback with nothing to time from", () => {
      expect(
        checkInTokenRefetchMs(
          { status: "pending", error: null, data: undefined },
          AT,
        ),
      ).toBe(CHECK_IN_TOKEN_FALLBACK_POLL_MS);
      expect(checkInTokenRefetchMs(success(undefined), AT)).toBe(
        CHECK_IN_TOKEN_FALLBACK_POLL_MS,
      );
    });

    it("polls on the fallback after a failure that may go through next time", () => {
      // The last data's rotation is long past; timing off it would retry
      // every second.
      for (const error of [
        new TypeError("Network request failed"),
        { statusCode: 502 },
        { statusCode: 408 },
        { statusCode: 429 },
      ]) {
        expect(checkInTokenRefetchMs(failed(error), after(9_999_999))).toBe(
          CHECK_IN_TOKEN_FALLBACK_POLL_MS,
        );
      }
    });

    it("polls on the fallback after a 401, which a renewed sign-in clears", () => {
      expect(
        checkInTokenRefetchMs(
          failed({ statusCode: 401, message: "Unauthorized" }),
          after(9_999_999),
        ),
      ).toBe(CHECK_IN_TOKEN_FALLBACK_POLL_MS);
    });

    it("stops after a refusal", () => {
      for (const error of [
        { statusCode: 403, message: "Forbidden" },
        { statusCode: 404, message: "Event not found" },
        { statusCode: 503, message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE },
      ]) {
        expect(checkInTokenRefetchMs(failed(error), AT)).toBe(false);
      }
    });

    it("never asks again sooner than the minimum", () => {
      expect(checkInTokenRefetchMs(success(20_000), after(4_000_000))).toBe(
        CHECK_IN_TOKEN_MIN_POLL_MS,
      );
    });
  });
});

describe("elapsedSince", () => {
  it("reads the larger of the two clocks", () => {
    const since = { monotonic: 100, wall: 1_000 };
    expect(elapsedSince(since, { monotonic: 600, wall: 1_200 })).toBe(500);
    expect(elapsedSince(since, { monotonic: 200, wall: 9_000 })).toBe(8_000);
  });
});

/**
 * Which failures of a check-in, or of a code request, may go through when
 * asked again later. s22's poll asks again only after one of these, and s18
 * clears its line when the member turns to typing a code.
 */
describe("isTransientCheckInFailure", () => {
  it("is the shared rule for no real answer, plus the rate limit", () => {
    for (const error of [
      new TypeError("Network request failed"),
      undefined,
      { statusCode: 500 },
      { statusCode: 502 },
      { statusCode: 503, message: "Service Unavailable" },
      { statusCode: 408 },
      { statusCode: 499 },
      { statusCode: 460 },
      { statusCode: 429, message: "ThrottlerException: Too Many Requests" },
    ]) {
      expect(isTransientCheckInFailure(error)).toBe(true);
    }
  });

  it("is not a refusal, or an environment with no check-in codes", () => {
    for (const error of [
      { statusCode: 400, message: "Bad Request" },
      { statusCode: 401 },
      { statusCode: 403, message: "Forbidden" },
      { statusCode: 404 },
      { statusCode: 503, message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE },
    ]) {
      expect(isTransientCheckInFailure(error)).toBe(false);
    }
  });
});

/**
 * The message is read from the API's source by
 * `apps/mobile/lib/events/check-in-outcome.spec.ts`: this package has no Node
 * types to read a file with.
 */
describe("isCheckInCodesUnconfigured", () => {
  it("is matched on the status and the message together", () => {
    expect(
      isCheckInCodesUnconfigured({
        statusCode: 503,
        message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
      }),
    ).toBe(true);
    expect(isCheckInCodesUnconfigured({ statusCode: 503 })).toBe(false);
    expect(
      isCheckInCodesUnconfigured({
        statusCode: 500,
        message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
      }),
    ).toBe(false);
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
    const mockPost = vi
      .fn()
      .mockResolvedValue(answered({ success: true }, 201));

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
    // The check-in awards the event's points in the same transaction, so the
    // member's total and the leaderboard must re-read too.
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["points"] });
  });

  it("re-reads the member's own row on a 409, which means they're already in", async () => {
    const mockPost = vi.fn().mockResolvedValue(
      refusedWith({ statusCode: 409, message: "Already checked in for this event" }),
    );
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    await expect(
      result.current.mutateAsync({ eventId: "event-123" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["attendance", "event-123", "me"],
    });
  });

  it("surfaces an error when check-in request fails", async () => {
    const mockError = { statusCode: 400, message: "You're outside the zone." };
    const mockPost = vi.fn().mockResolvedValue(refusedWith(mockError));

    const mockClient = {
      POST: mockPost,
    };

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper(mockClient),
    });

    await expect(
      result.current.mutateAsync({ eventId: "event-999" }),
    ).rejects.toBe(mockError);
  });

  it("rejects an empty-bodied 5xx, which wrote nothing, rather than reading it as a check-in", async () => {
    // An edge's 502 during a deploy. Check-in has no outbox: read as a
    // success, the member would leave believing they were on the roster.
    for (const error of [undefined, ""] as const) {
      const mockPost = vi.fn().mockResolvedValue(emptyBodied(502, error));
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result, unmount } = renderHook(() => useCheckIn(), {
        wrapper: createWrapper({ POST: mockPost }),
      });

      await expect(
        result.current.mutateAsync({ eventId: "event-123", token: "signed" }),
      ).rejects.toMatchObject({ statusCode: 502 });
      expect(invalidateQueriesSpy).not.toHaveBeenCalled();
      invalidateQueriesSpy.mockRestore();
      unmount();
    }
  });

  it("ensures queryClient.invalidateQueries is called on success", async () => {
    const mockPost = vi
      .fn()
      .mockResolvedValue(answered({ success: true }, 201));

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
    const mockPost = vi
      .fn()
      .mockResolvedValue(answered({ success: true }, 201));

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

/**
 * An officer's roster writes. An empty-bodied 5xx would otherwise read as a
 * status set, or absentees marked, when nothing was written.
 */
describe("the officer's attendance writes", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "AttendanceWritesWrapper";
    return Wrapper;
  };

  it("keys every attendance write under `attendance`, so a failure reports by feature (#3393, #3905)", async () => {
    // The Sentry reporter groups a failed mutation by its key's root; with no
    // key it is `unkeyed`, which is how FRAPP-WEB-7's 400 arrived.
    const ok = vi.fn().mockResolvedValue(answered({ marked: 0 }));
    const { result } = renderHook(
      () => ({
        checkIn: useCheckIn(),
        status: useUpdateAttendanceStatus(),
        autoAbsent: useAutoAbsent(),
      }),
      { wrapper: createWrapper({ POST: ok, PATCH: ok }) },
    );
    await act(async () => {
      await result.current.checkIn.mutateAsync({ eventId: "event-1" });
      await result.current.status.mutateAsync({
        eventId: "event-1",
        userId: "user-1",
        body: { status: "PRESENT" },
      });
      await result.current.autoAbsent.mutateAsync("event-1");
    });
    const keys = queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.options.mutationKey);
    expect(keys).toEqual([
      ["attendance", "check-in"],
      ["attendance", "update-status"],
      ["attendance", "auto-absent"],
    ]);
  });

  it("rejects an empty-bodied 5xx when setting a member's status", async () => {
    for (const error of [undefined, ""] as const) {
      const mockPatch = vi.fn().mockResolvedValue(emptyBodied(502, error));
      const { result, unmount } = renderHook(
        () => useUpdateAttendanceStatus(),
        { wrapper: createWrapper({ PATCH: mockPatch }) },
      );

      await expect(
        result.current.mutateAsync({
          eventId: "event-1",
          userId: "user-1",
          body: { status: "PRESENT" },
        }),
      ).rejects.toMatchObject({ statusCode: 502 });
      unmount();
    }
  });

  it("rejects an empty-bodied 5xx when marking absentees", async () => {
    for (const error of [undefined, ""] as const) {
      const mockPost = vi.fn().mockResolvedValue(emptyBodied(502, error));
      const { result, unmount } = renderHook(() => useAutoAbsent(), {
        wrapper: createWrapper({ POST: mockPost }),
      });

      await expect(result.current.mutateAsync("event-1")).rejects.toMatchObject(
        { statusCode: 502 },
      );
      unmount();
    }
  });

  it("resolves with the server's answer on a 2xx", async () => {
    const mockPatch = vi.fn().mockResolvedValue(answered({ id: "row-1" }));
    const mockPost = vi.fn().mockResolvedValue(answered({ marked: 3 }, 201));
    const status = renderHook(() => useUpdateAttendanceStatus(), {
      wrapper: createWrapper({ PATCH: mockPatch }),
    });
    const absent = renderHook(() => useAutoAbsent(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    await expect(
      status.result.current.mutateAsync({
        eventId: "event-1",
        userId: "user-1",
        body: { status: "LATE" },
      }),
    ).resolves.toEqual({ id: "row-1" });
    await expect(absent.result.current.mutateAsync("event-1")).resolves.toEqual(
      { marked: 3 },
    );
  });
});

describe("selectOwnAttendance", () => {
  it("reads the row out of `/attendance/me`'s answer", () => {
    expect(
      selectOwnAttendance({
        attendance: { status: "LATE", check_in_time: "2026-11-09T19:05:00Z" },
      }),
    ).toEqual({ status: "LATE", checkInTime: "2026-11-09T19:05:00Z" });
    expect(
      selectOwnAttendance({ attendance: { status: "EXCUSED" } }),
    ).toEqual({ status: "EXCUSED", checkInTime: null });
  });

  it("is null for no row or an unreadable one", () => {
    expect(selectOwnAttendance({ attendance: null })).toBeNull();
    expect(selectOwnAttendance({ attendance: { status: "GONE" } })).toBeNull();
    expect(selectOwnAttendance(undefined)).toBeNull();
  });
});

describe("useMyAttendance", () => {
  const wrapperFor = (mockClient: unknown) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "MyAttendanceHookWrapper";
    return Wrapper;
  };

  it("reads the member's own row", async () => {
    const row = { id: "a-1", status: "PRESENT", check_in_time: "2026-11-07T00:52:00Z" };
    const mockGet = vi.fn().mockResolvedValue(answered({ attendance: row }));
    const { result } = renderHook(() => useMyAttendance("event-1"), {
      wrapper: wrapperFor({ GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ attendance: row });
    expect(mockGet).toHaveBeenCalledWith("/v1/events/{eventId}/attendance/me", {
      params: { path: { eventId: "event-1" } },
    });
  });

  it("asks nothing without an event", () => {
    const mockGet = vi.fn();
    renderHook(() => useMyAttendance(""), {
      wrapper: wrapperFor({ GET: mockGet }),
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
