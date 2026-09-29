import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import {
  chatSidebarKeys,
  useChatSidebar,
  useSetChannelPinned,
  useSetSidebarFilter,
  useSetSidebarSectionCollapsed,
  useSidebarPreferences,
  type ChatSidebar,
} from "./use-chat-sidebar";

const CHAPTER = "chapter-1";
const KEY = chatSidebarKeys.chapter(CHAPTER);

const stored: ChatSidebar = {
  unread_only: false,
  hide_muted: true,
  collapsed_sections: ["direct"],
  pinned_channel_ids: ["general"],
};

function setup(
  client: Record<string, unknown>,
  chapterId: string | null = CHAPTER,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  return { queryClient, Wrapper };
}

/** A promise the test resolves by hand, to look at the cache mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useChatSidebar", () => {
  it("reads the arrangement under a chapter-scoped key", async () => {
    const GET = vi.fn().mockResolvedValue({ data: stored, error: null });
    const { queryClient, Wrapper } = setup({ GET });

    const { result } = renderHook(() => useChatSidebar(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/chat-sidebar");
    expect(queryClient.getQueryData(KEY)).toEqual(stored);
  });

  it("does not run without an active chapter", () => {
    const GET = vi.fn();
    const { Wrapper } = setup({ GET }, null);

    const { result } = renderHook(() => useChatSidebar(), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(GET).not.toHaveBeenCalled();
  });
});

describe("useSidebarPreferences", () => {
  it("is the default arrangement until the read lands", () => {
    const GET = vi.fn(() => new Promise(() => {}));
    const { Wrapper } = setup({ GET });

    const { result } = renderHook(() => useSidebarPreferences(), {
      wrapper: Wrapper,
    });

    expect([...result.current.pinnedIds]).toEqual([]);
    expect([...result.current.collapsed]).toEqual([]);
    expect(result.current.filters).toEqual({
      unreadOnly: false,
      hideMuted: false,
    });
  });

  it("stays the default when the read fails, so no channel is hidden", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("x") });
    const { Wrapper } = setup({ GET });

    const { result } = renderHook(
      () => ({ query: useChatSidebar(), prefs: useSidebarPreferences() }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.prefs.filters).toEqual({
      unreadOnly: false,
      hideMuted: false,
    });
  });

  it("maps the stored arrangement", async () => {
    const GET = vi.fn().mockResolvedValue({ data: stored, error: null });
    const { Wrapper } = setup({ GET });

    const { result } = renderHook(() => useSidebarPreferences(), {
      wrapper: Wrapper,
    });

    await waitFor(() =>
      expect(result.current.pinnedIds.has("general")).toBe(true),
    );
    expect(result.current.collapsed.has("direct")).toBe(true);
    expect(result.current.filters).toEqual({
      unreadOnly: false,
      hideMuted: true,
    });
  });
});

describe("sidebar writes", () => {
  let GET: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    GET = vi.fn().mockResolvedValue({ data: stored, error: null });
  });

  it("pins at once, then keeps the server's answer", async () => {
    const answer = deferred<{ data: ChatSidebar; error: null }>();
    const PUT = vi.fn(() => answer.promise);
    const { queryClient, Wrapper } = setup({ GET, PUT });
    queryClient.setQueryData(KEY, stored);

    // The sidebar is on screen, so a re-read would really go out.
    const { result } = renderHook(
      () => ({ read: useChatSidebar(), write: useSetChannelPinned() }),
      { wrapper: Wrapper },
    );
    act(() =>
      result.current.write.mutate({ channelId: "social", pinned: true }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
      ).toEqual(["general", "social"]),
    );
    expect(PUT).toHaveBeenCalledWith("/v1/chat-sidebar/pins/{channelId}", {
      params: { path: { channelId: "social" } },
    });

    const fromServer = { ...stored, pinned_channel_ids: ["social", "general"] };
    answer.resolve({ data: fromServer, error: null });
    await waitFor(() => expect(result.current.write.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
    ).toEqual(["social", "general"]);
    // A lone write's answer is the whole arrangement: no second round trip.
    expect(GET).not.toHaveBeenCalled();
  });

  it("unpins with DELETE", async () => {
    const DELETE = vi.fn().mockResolvedValue({
      data: { ...stored, pinned_channel_ids: [] },
      error: null,
    });
    const { queryClient, Wrapper } = setup({ GET, DELETE });
    queryClient.setQueryData(KEY, stored);

    const { result } = renderHook(() => useSetChannelPinned(), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ channelId: "general", pinned: false }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(DELETE).toHaveBeenCalledWith("/v1/chat-sidebar/pins/{channelId}", {
      params: { path: { channelId: "general" } },
    });
    expect(
      queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
    ).toEqual([]);
  });

  it("folds and unfolds a section", async () => {
    const PUT = vi.fn().mockResolvedValue({
      data: { ...stored, collapsed_sections: ["direct", "pinned"] },
      error: null,
    });
    const DELETE = vi.fn().mockResolvedValue({
      data: { ...stored, collapsed_sections: [] },
      error: null,
    });
    const { queryClient, Wrapper } = setup({ GET, PUT, DELETE });
    queryClient.setQueryData(KEY, stored);

    const { result } = renderHook(() => useSetSidebarSectionCollapsed(), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ sectionKey: "pinned", collapsed: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(PUT).toHaveBeenCalledWith(
      "/v1/chat-sidebar/collapsed/{sectionKey}",
      {
        params: { path: { sectionKey: "pinned" } },
      },
    );

    act(() =>
      result.current.mutate({ sectionKey: "direct", collapsed: false }),
    );
    await waitFor(() =>
      expect(DELETE).toHaveBeenCalledWith(
        "/v1/chat-sidebar/collapsed/{sectionKey}",
        { params: { path: { sectionKey: "direct" } } },
      ),
    );
  });

  it("sends only the filter that changed", async () => {
    const PATCH = vi.fn().mockResolvedValue({
      data: { ...stored, unread_only: true },
      error: null,
    });
    const { queryClient, Wrapper } = setup({ GET, PATCH });
    queryClient.setQueryData(KEY, stored);

    const { result } = renderHook(() => useSetSidebarFilter(), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ unread_only: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(PATCH).toHaveBeenCalledWith("/v1/chat-sidebar", {
      body: { unread_only: true },
    });
    expect(queryClient.getQueryData<ChatSidebar>(KEY)?.unread_only).toBe(true);
  });

  it("re-reads the server's state when a write fails, rather than keeping the guess", async () => {
    const PUT = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("no") });
    const { queryClient, Wrapper } = setup({ GET, PUT });
    queryClient.setQueryData(KEY, stored);
    const onError = vi.fn();

    // The sidebar is on screen, so its query has an observer to refetch for.
    const { result } = renderHook(
      () => ({
        read: useChatSidebar(),
        write: useSetChannelPinned({ onError }),
      }),
      { wrapper: Wrapper },
    );
    GET.mockClear();
    act(() =>
      result.current.write.mutate({ channelId: "social", pinned: true }),
    );

    await waitFor(() => expect(result.current.write.isError).toBe(true));
    await waitFor(() => expect(GET).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
      ).toEqual(["general"]),
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports every failed write, not only the latest one on the hook", async () => {
    const first = deferred<{ data: null; error: Error }>();
    const second = deferred<{ data: null; error: Error }>();
    const PUT = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { queryClient, Wrapper } = setup({ GET, PUT });
    queryClient.setQueryData(KEY, stored);
    const onError = vi.fn();

    const { result } = renderHook(() => useSetChannelPinned({ onError }), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ channelId: "a", pinned: true }));
    act(() => result.current.mutate({ channelId: "b", pinned: true }));
    await waitFor(() => expect(PUT).toHaveBeenCalledTimes(2));

    first.resolve({ data: null, error: new Error("a failed") });
    second.resolve({ data: null, error: new Error("b failed") });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });

  it("does not seed a cleared cache with the answer to a write sent before the clear", async () => {
    // Signing out or switching account clears the cache. The key names the
    // chapter, not the member, so writing the old answer back would show the
    // next member of this chapter the last member's arrangement.
    const answer = deferred<{ data: ChatSidebar; error: null }>();
    const PUT = vi.fn(() => answer.promise);
    const { queryClient, Wrapper } = setup({ GET, PUT });
    queryClient.setQueryData(KEY, stored);

    const { result } = renderHook(() => useSetChannelPinned(), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ channelId: "social", pinned: true }));
    await waitFor(() => expect(PUT).toHaveBeenCalled());

    queryClient.clear();
    answer.resolve({
      data: { ...stored, pinned_channel_ids: ["general", "social"] },
      error: null,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it("files a write under the chapter it was sent for, across a chapter switch", async () => {
    const answer = deferred<{ data: ChatSidebar; error: null }>();
    const PUT = vi.fn(() => answer.promise);
    let chapter = CHAPTER;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={
          { GET, PUT } as unknown as ReturnType<
            typeof import("@repo/api-sdk").createFrappClient
          >
        }
        chapterId={chapter}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    const OTHER_KEY = chatSidebarKeys.chapter("chapter-2");
    queryClient.setQueryData(KEY, stored);
    queryClient.setQueryData(OTHER_KEY, { ...stored, pinned_channel_ids: [] });

    const { result, rerender } = renderHook(() => useSetChannelPinned(), {
      wrapper: Wrapper,
    });
    act(() => result.current.mutate({ channelId: "social", pinned: true }));
    await waitFor(() => expect(PUT).toHaveBeenCalled());

    // The member switches chapter while the write is in flight.
    chapter = "chapter-2";
    rerender();
    answer.resolve({
      data: { ...stored, pinned_channel_ids: ["general", "social"] },
      error: null,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
    ).toEqual(["general", "social"]);
    expect(
      queryClient.getQueryData<ChatSidebar>(OTHER_KEY)?.pinned_channel_ids,
    ).toEqual([]);
  });

  it("trusts no answer when writes overlap, and re-reads once after the last", async () => {
    const first = deferred<{ data: ChatSidebar; error: null }>();
    const second = deferred<{ data: ChatSidebar; error: null }>();
    const PUT = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    // The re-read after the last write settles returns both pins.
    GET.mockResolvedValue({
      data: { ...stored, pinned_channel_ids: ["general", "a", "b"] },
      error: null,
    });
    const { queryClient, Wrapper } = setup({ GET, PUT });
    queryClient.setQueryData(KEY, stored);

    const { result } = renderHook(
      () => ({
        read: useChatSidebar(),
        a: useSetChannelPinned(),
        b: useSetChannelPinned(),
      }),
      { wrapper: Wrapper },
    );
    act(() => result.current.a.mutate({ channelId: "a", pinned: true }));
    act(() => result.current.b.mutate({ channelId: "b", pinned: true }));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
      ).toEqual(["general", "a", "b"]),
    );

    // The first answer knows nothing of `b`; applying it would drop `b` from
    // the screen. The second (below) may equally predate a change, since
    // answers can arrive out of the order the server applied them in.
    GET.mockClear();
    first.resolve({
      data: { ...stored, pinned_channel_ids: ["general", "a"] },
      error: null,
    });
    await waitFor(() => expect(result.current.a.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
    ).toEqual(["general", "a", "b"]);

    // An answer that predates `a`'s change: applying it would drop `a`.
    second.resolve({
      data: { ...stored, pinned_channel_ids: ["general", "b"] },
      error: null,
    });
    await waitFor(() => expect(result.current.b.isSuccess).toBe(true));
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatSidebar>(KEY)?.pinned_channel_ids,
      ).toEqual(["general", "a", "b"]),
    );
  });
});
