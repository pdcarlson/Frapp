/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  useConfirmChapterLogo,
  useRemoveChapterLogo,
  useRequestChapterLogoUploadUrl,
  useUploadChapterLogo,
} from "./use-chapters";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * The chapter logo hooks (#2591): mint, PUT, confirm, in that order, with
 * confirm as the step that changes the logo, so a failure anywhere before it
 * leaves the chapter's current logo alone.
 */
const CHAPTER_ID = "chapter-abc";
const STORAGE_PATH = `chapters/${CHAPTER_ID}/branding/logo-1234.png`;

describe("chapter logo hooks", () => {
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper(client: unknown) {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
        chapterId={CHAPTER_ID}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "ChapterLogoWrapper";
    return Wrapper;
  }

  const upload = {
    body: new Blob(["png"], { type: "image/png" }),
    filename: "crest.png",
    contentType: "image/png",
  };

  function clientWith(post: ReturnType<typeof vi.fn>) {
    return { POST: post, DELETE: vi.fn() };
  }

  it("mints, PUTs with the resolved type, then confirms the minted path", async () => {
    const post = vi.fn(async (path: string) =>
      path === "/v1/chapters/current/logo-url"
        ? {
            data: {
              upload_url: "https://storage.example/signed",
              storage_path: STORAGE_PATH,
            },
            error: null,
          }
        : { data: { id: CHAPTER_ID, logo_path: STORAGE_PATH }, error: null },
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUploadChapterLogo(), {
      wrapper: wrapper(clientWith(post)),
    });

    await act(() => result.current.mutateAsync(upload));

    expect(post).toHaveBeenNthCalledWith(1, "/v1/chapters/current/logo-url", {
      body: { filename: "crest.png", content_type: "image/png" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://storage.example/signed", {
      method: "PUT",
      body: upload.body,
      // No upsert: every mint is a fresh key (#2592).
      headers: { "content-type": "image/png" },
    });
    expect(post).toHaveBeenNthCalledWith(2, "/v1/chapters/current/logo", {
      body: { storage_path: STORAGE_PATH },
    });
    // The shell repaints from the current-chapter query, which the
    // `["chapters"]` prefix covers.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chapters"] });
  });

  it("never confirms when the PUT is refused, so the old logo stays", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 413 }));
    const post = vi.fn(async () => ({
      data: {
        upload_url: "https://storage.example/signed",
        storage_path: STORAGE_PATH,
      },
      error: null,
    }));
    const { result } = renderHook(() => useUploadChapterLogo(), {
      wrapper: wrapper(clientWith(post)),
    });

    await expect(act(() => result.current.mutateAsync(upload))).rejects.toThrow(
      "Logo upload failed (413)",
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("never PUTs when the mint is refused", async () => {
    const post = vi.fn(async () => ({
      data: null,
      error: { message: "Invalid content type" },
    }));
    const { result } = renderHook(() => useUploadChapterLogo(), {
      wrapper: wrapper(clientWith(post)),
    });

    await expect(act(() => result.current.mutateAsync(upload))).rejects.toEqual(
      {
        message: "Invalid content type",
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes the logo through the DELETE route and repaints the shell", async () => {
    const del = vi.fn(async () => ({ data: { id: CHAPTER_ID }, error: null }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRemoveChapterLogo(), {
      wrapper: wrapper({ POST: vi.fn(), DELETE: del }),
    });

    await act(() => result.current.mutateAsync());

    expect(del).toHaveBeenCalledWith("/v1/chapters/current/logo");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chapters"] });
  });

  it("repaints nothing when the removal is refused", async () => {
    const del = vi.fn(async () => ({ data: null, error: { message: "403" } }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRemoveChapterLogo(), {
      wrapper: wrapper({ POST: vi.fn(), DELETE: del }),
    });

    await expect(act(() => result.current.mutateAsync())).rejects.toEqual({
      message: "403",
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("mints for a client that PUTs itself, sending only the two declared fields", async () => {
    const post = vi.fn(async () => ({
      data: {
        upload_url: "https://storage.example/signed",
        storage_path: STORAGE_PATH,
      },
      error: null,
    }));
    const { result } = renderHook(() => useRequestChapterLogoUploadUrl(), {
      wrapper: wrapper(clientWith(post)),
    });

    // Mobile's upload pipeline hands every caller `size_bytes`; the route
    // forbids it, so the hook drops it.
    await act(() =>
      result.current.mutateAsync({
        filename: "crest.png",
        content_type: "image/png",
        size_bytes: 1234,
      } as { filename: string; content_type: string }),
    );

    expect(post).toHaveBeenCalledWith("/v1/chapters/current/logo-url", {
      body: { filename: "crest.png", content_type: "image/png" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms the path and refetches the current chapter before resolving", async () => {
    const post = vi.fn(async () => ({
      data: { id: CHAPTER_ID, logo_path: STORAGE_PATH },
      error: null,
    }));
    // A refetch that lands only when the test says so.
    let landRefetch!: () => void;
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(
        () => new Promise<void>((resolve) => (landRefetch = resolve)),
      );
    const { result } = renderHook(() => useConfirmChapterLogo(), {
      wrapper: wrapper(clientWith(post)),
    });

    let resolved = false;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync(STORAGE_PATH)
        .then(() => (resolved = true));
    });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith("/v1/chapters/current/logo", {
      body: { storage_path: STORAGE_PATH },
    });
    // The current-chapter query, which the `["chapters"]` prefix covers.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chapters"] });
    // Still waiting on the refetch, so a caller's busy state holds.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);

    await act(async () => {
      landRefetch();
      await pending;
    });
    expect(resolved).toBe(true);
  });
});
