import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import {
  usePauseStudySession,
  useStartStudySession,
  useStudyHeartbeat,
  useStudySessions,
  useStopStudySession,
} from "./use-study";

/**
 * These pin one property that is invisible until a member switches chapters:
 * the session list is keyed by chapter.
 *
 * Both apps clear the whole cache on a chapter switch (mobile since #1042), so
 * the scoped key is defense in depth. The mutations invalidate the bare
 * `["study-sessions"]` prefix, which still matches, and that is asserted here
 * so a future "tidy-up" of the key cannot silently break the refresh.
 */

const CHAPTER_ID = "chapter-abc";

function makeWrapper(
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string,
  displayName: string,
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={mockClient as unknown as ReturnType<typeof createFrappClient>}
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = displayName;
  return Wrapper;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useStudySessions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
  });

  it("scopes its cache entry to the active chapter", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useStudySessions(), {
      wrapper: makeWrapper(
        queryClient,
        { GET: mockGet },
        CHAPTER_ID,
        "UseStudySessionsTestWrapper",
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData(["study-sessions", CHAPTER_ID]),
    ).toEqual([]);
    // The unscoped key must hold nothing, or a second chapter would read it.
    expect(queryClient.getQueryData(["study-sessions"])).toBeUndefined();
  });

  it("does not serve one chapter's sessions to another", async () => {
    const rows = [{ id: "ss-1", status: "ACTIVE" }];
    const mockGet = vi.fn().mockResolvedValue({ data: rows, error: null });

    const first = renderHook(() => useStudySessions(), {
      wrapper: makeWrapper(
        queryClient,
        { GET: mockGet },
        CHAPTER_ID,
        "FirstChapterWrapper",
      ),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useStudySessions(), {
      wrapper: makeWrapper(
        queryClient,
        { GET: mockGet },
        "chapter-other",
        "SecondChapterWrapper",
      ),
    });

    // A shared key would hand the second chapter the first one's rows
    // synchronously, before its own fetch resolved.
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("still fetches when no chapter claim is present", async () => {
    // Claim-absent is still a production shape (no membership yet, or a
    // hook-off incident). ChapterGuard resolves a sole membership server-side.
    // An `enabled: !!chapterId` guard here would blank the screen for those users.
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useStudySessions(), {
      wrapper: makeWrapper(
        queryClient,
        { GET: mockGet },
        "",
        "NoChapterClaimWrapper",
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/v1/study-sessions");
  });
});

describe("useStopStudySession", () => {
  it("invalidates the chapter-scoped session list through the bare prefix", async () => {
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { id: "ss-1", status: "COMPLETED" }, error: null });

    const { result } = renderHook(() => useStopStudySession(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "UseStopStudySessionTestWrapper",
      ),
    });

    await result.current.mutateAsync();

    expect(mockPost).toHaveBeenCalledWith("/v1/study-sessions/stop");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["study-sessions"],
    });
  });
});

describe("useStudyHeartbeat", () => {
  it("posts accuracy_meters when the client supplies a reading", async () => {
    const queryClient = makeQueryClient();
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { id: "ss-1", status: "ACTIVE" }, error: null });

    const { result } = renderHook(() => useStudyHeartbeat(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "UseStudyHeartbeatAccuracyWrapper",
      ),
    });

    await result.current.mutateAsync({
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 12,
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/study-sessions/heartbeat", {
      body: { lat: 42.73, lng: -73.68, accuracy_meters: 12 },
    });
  });

  it("omits accuracy_meters when the client does not supply one", async () => {
    const queryClient = makeQueryClient();
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { id: "ss-1", status: "ACTIVE" }, error: null });

    const { result } = renderHook(() => useStudyHeartbeat(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "UseStudyHeartbeatOmitWrapper",
      ),
    });

    await result.current.mutateAsync({ lat: 42.73, lng: -73.68 });

    expect(mockPost).toHaveBeenCalledWith("/v1/study-sessions/heartbeat", {
      body: { lat: 42.73, lng: -73.68 },
    });
  });
});

/**
 * A heartbeat or pause can end the session server-side and answers 2xx with
 * the closed row. Left unrefreshed, the cached list still holds the session as
 * ACTIVE, so returning to the study screen restores a dead, ticking timer, and
 * PAUSED_EXPIRED's awarded minutes never reach the points total.
 */
describe("a write that ends the session", () => {
  it("refreshes nothing after a routine heartbeat on an ACTIVE session", async () => {
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mockPost = vi
      .fn()
      .mockResolvedValue({
        data: { id: "ss-1", status: "ACTIVE" },
        error: null,
      });
    const { result } = renderHook(() => useStudyHeartbeat(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "HeartbeatActiveWrapper",
      ),
    });

    await result.current.mutateAsync({ lat: 42.73, lng: -73.68 });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(["EXPIRED", "LOCATION_INVALID", "PAUSED_EXPIRED"])(
    "refreshes the session list and points when a heartbeat ends it as %s",
    async (status) => {
      const queryClient = makeQueryClient();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const mockPost = vi
        .fn()
        .mockResolvedValue({ data: { id: "ss-1", status }, error: null });
      const { result } = renderHook(() => useStudyHeartbeat(), {
        wrapper: makeWrapper(
          queryClient,
          { POST: mockPost },
          CHAPTER_ID,
          "HeartbeatEndedWrapper",
        ),
      });

      await result.current.mutateAsync({ lat: 42.73, lng: -73.68 });

      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["study-sessions"],
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["points"] });
    },
  );

  it("refreshes points after a start, which may settle an expired pause", async () => {
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { id: "ss-2", status: "ACTIVE" }, error: null });
    const { result } = renderHook(() => useStartStudySession(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "StartWrapper",
      ),
    });

    await result.current.mutateAsync({ geofence_id: "g-1", lat: 1, lng: 2 });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["study-sessions"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["points"] });
  });

  it("refreshes points only when a pause settles the session", async () => {
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mockPost = vi
      .fn()
      .mockResolvedValueOnce({
        data: { id: "ss-1", status: "ACTIVE" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "ss-1", status: "PAUSED_EXPIRED" },
        error: null,
      });
    const { result } = renderHook(() => usePauseStudySession(), {
      wrapper: makeWrapper(
        queryClient,
        { POST: mockPost },
        CHAPTER_ID,
        "PauseWrapper",
      ),
    });

    await result.current.mutateAsync();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["study-sessions"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["points"] });

    await result.current.mutateAsync();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["points"] });
  });
});
