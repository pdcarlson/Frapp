import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { useAttendance, useCheckIn } from "./use-attendance";
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

    renderHook(() => useAttendance(""), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(mockGet).not.toHaveBeenCalled();
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
    vi.spyOn(queryClient, "invalidateQueries");
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

  it("calls check-in endpoint and invalidates attendance query on success", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const mockClient = {
      POST: mockPost,
    };

    const { result } = renderHook(() => useCheckIn(), {
      wrapper: createWrapper(mockClient),
    });

    await expect(result.current.mutateAsync("event-123")).resolves.toEqual({ success: true });

    expect(mockPost).toHaveBeenCalledWith("/v1/events/{eventId}/attendance/check-in", {
      params: { path: { eventId: "event-123" } },
      body: {},
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
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

    await expect(result.current.mutateAsync("event-999")).rejects.toThrow(mockError);

    expect(mockPost).toHaveBeenCalledWith("/v1/events/{eventId}/attendance/check-in", {
      params: { path: { eventId: "event-999" } },
      body: {},
    });
  });
});
