import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import { useStudySessions, useStopStudySession } from "./use-study";

/**
 * These pin one property that is invisible until a member switches chapters:
 * the session list is keyed by chapter.
 *
 * `apps/web` clears the whole cache on a chapter switch; `apps/mobile` does not
 * (#1042), so on mobile an unscoped key is not a latent bug — it is the rows the
 * member sees on the study screen after switching. The mutations invalidate the
 * bare `["study-sessions"]` prefix, which still matches, and that is asserted
 * here so a future "tidy-up" of the key cannot silently break the refresh.
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
    // #805: no production token carries `active_chapter_id`, and ChapterGuard
    // resolves a sole membership server-side. An `enabled: !!chapterId` guard
    // here would blank the screen for every member in production.
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
