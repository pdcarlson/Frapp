import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useChannelUnreadCounts,
  useMarkChannelRead,
  useLeaveChannel,
  useAuthorAvatars,
  useChannelNotificationPreferences,
  useSetChannelNotificationLevel,
  channelSetFingerprint,
  CHANNEL_NOTIFICATION_PREFERENCES_KEY,
} from "./use-chat";
import { FrappClientProvider } from "./use-frapp-client";
import React from "react";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

describe("useChannelUnreadCounts", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("returns one row per channel, including zero-count channels", async () => {
    const rows = [
      { channel_id: "chan-1", unread_count: 3, mention_count: 1 },
      { channel_id: "chan-2", unread_count: 0, mention_count: 0 },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: rows, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelUnreadCounts(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith("/v1/channels/unread");
    expect(result.current.data).toEqual(rows);
  });

  it("returns an empty array rather than undefined when the API sends none", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelUnreadCounts(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("stays idle and never calls the API when disabled", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(
      () => useChannelUnreadCounts({ enabled: false }),
      { wrapper: createWrapper(queryClient, mockClient) },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useMarkChannelRead", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts to the channel's read endpoint and invalidates channel queries", async () => {
    const mockPost = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith("/v1/channels/{id}/read", {
      params: { path: { id: "chan-1" } },
    });
    // Badges come from the ["channels", "unread"] key; invalidating the
    // broader ["channels"] key is what makes a mark-read clear them via
    // React Query's prefix matching, without a second, narrower invalidation
    // that could drift out of sync with the unread query's own key.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["channels"] });
  });

  it("surfaces an error without invalidating anything", async () => {
    const mockError = new Error("mark-read failed");
    const mockPost = vi.fn().mockResolvedValue({ data: null, error: mockError });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// #2303: the hide lands through the list refetch, since a hidden DM stays in
// `GET /v1/channels` flagged `hidden` rather than being removed from it.
describe("useLeaveChannel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts to the channel's leave endpoint and waits for the channel refetch", async () => {
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { success: true }, error: null });
    let resolveRefetch!: () => void;
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    const { result } = renderHook(() => useLeaveChannel(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    let settled = false;
    const done = result.current.mutateAsync("dm-1").then(() => {
      settled = true;
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith("/v1/channels/{id}/leave", {
      params: { path: { id: "dm-1" } },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["channels"] });
    // Not settled until the list has been re-read, or a caller re-rendering
    // on resolve would still draw the row it just hid.
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRefetch();
    await done;
    expect(settled).toBe(true);
  });

  it("surfaces an error without invalidating anything", async () => {
    const mockError = new Error("leave failed");
    const mockPost = vi.fn().mockResolvedValue({ data: null, error: mockError });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useLeaveChannel(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    result.current.mutate("dm-1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(mockError);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useAuthorAvatars", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("sends one representative message id per distinct avatar path, not one per message", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { "path/a": "https://signed/a" },
      error: null,
    });
    const mockClient = { POST: mockPost };
    const messages = [
      { id: "msg-1", author_avatar_path: "path/a" },
      { id: "msg-2", author_avatar_path: "path/a" },
      { id: "msg-3", author_avatar_path: null },
    ];

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/channels/{id}/messages/avatars",
      {
        params: { path: { id: "chan-1" } },
        body: { message_ids: ["msg-1"] },
      },
    );
    expect(result.current.data).toEqual({ "path/a": "https://signed/a" });
  });

  it("is disabled — never calls POST — when no message carries an avatar path", async () => {
    const mockPost = vi.fn();
    const mockClient = { POST: mockPost };
    const messages = [{ id: "msg-1", author_avatar_path: null }];

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("chunks past the server's per-request cap and merges the results", async () => {
    // 60 distinct authors — one more than the server's 50-id cap
    // (MAX_AUTHOR_AVATAR_PATHS_PER_REQUEST in chat.dto.ts) — should split
    // into two requests rather than 400 the whole batch.
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: `msg-${i}`,
      author_avatar_path: `path/${i}`,
    }));
    const mockPost = vi.fn().mockImplementation(async (_url, { body }) => ({
      data: Object.fromEntries(
        (body.message_ids as string[]).map((id: string) => [
          `path/${id.slice(4)}`,
          `https://signed/${id}`,
        ]),
      ),
      error: null,
    }));
    const mockClient = { POST: mockPost };

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(60);
  });

  it("keeps one chunk's avatars when a different chunk's request fails", async () => {
    // 60 distinct authors again — two chunks. Only the second one fails, so
    // the first chunk's 50 avatars should still render rather than the whole
    // query degrading every author to initials over one bad chunk.
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: `msg-${i}`,
      author_avatar_path: `path/${i}`,
    }));
    const mockPost = vi
      .fn()
      .mockImplementationOnce(async (_url, { body }) => ({
        data: Object.fromEntries(
          (body.message_ids as string[]).map((id: string) => [
            `path/${id.slice(4)}`,
            `https://signed/${id}`,
          ]),
        ),
        error: null,
      }))
      .mockImplementationOnce(async () => ({
        data: null,
        error: new Error("chunk 2 failed"),
      }));
    const mockClient = { POST: mockPost };

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(50);
  });
});

describe("channelSetFingerprint", () => {
  it("is empty for missing or empty lists", () => {
    expect(channelSetFingerprint(undefined)).toBe("");
    expect(channelSetFingerprint(null)).toBe("");
    expect(channelSetFingerprint([])).toBe("");
    expect(channelSetFingerprint("not-an-array")).toBe("");
  });

  it("joins id:name pairs in sorted order so a shuffle is not a set change", () => {
    expect(
      channelSetFingerprint([
        { id: "b", name: "alumni" },
        { id: "a", name: "general" },
      ]),
    ).toBe(
      channelSetFingerprint([
        { id: "a", name: "general" },
        { id: "b", name: "alumni" },
      ]),
    );
    expect(
      channelSetFingerprint([{ id: "a", name: "general" }]),
    ).not.toBe(
      channelSetFingerprint([
        { id: "a", name: "general" },
        { id: "b", name: "alumni" },
      ]),
    );
    expect(
      channelSetFingerprint([{ id: "a", name: "general" }]),
    ).not.toBe(channelSetFingerprint([{ id: "a", name: "announcements" }]));
  });

  it("skips rows without a string id so a prefs-shaped payload does not fingerprint", () => {
    expect(
      channelSetFingerprint([{ channel_id: "chan-1", level: "mentions" }]),
    ).toBe("");
  });
});

describe("useChannelNotificationPreferences", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("GETs the effective-level collection, including every readable channel", async () => {
    const rows = [
      { channel_id: "chan-1", level: "mentions" },
      { channel_id: "chan-announce", level: "all" },
      { channel_id: "chan-audit", level: "off" },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: rows, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelNotificationPreferences(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/channels/notification-preferences",
    );
    expect(result.current.data).toEqual(rows);
  });

  it("returns an empty array rather than undefined when the API sends none", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelNotificationPreferences(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("refetches when the channel set grows or is renamed, and not when mark-read refetches the same set", async () => {
    let channels: { id: string; name: string }[] = [
      { id: "chan-1", name: "general" },
    ];
    const mockGet = vi.fn(async (url: string) => {
      if (url === "/v1/channels") {
        return { data: channels, error: null };
      }
      if (url === "/v1/channels/notification-preferences") {
        return {
          data: channels.map((c) => ({
            channel_id: c.id,
            level: c.name === "announcements" ? "all" : "mentions",
          })),
          error: null,
        };
      }
      throw new Error(`unexpected GET ${url}`);
    });
    const mockClient = { GET: mockGet };
    const prefsGets = () =>
      mockGet.mock.calls.filter(
        ([url]) => url === "/v1/channels/notification-preferences",
      ).length;

    const { result } = renderHook(() => useChannelNotificationPreferences(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(
        mockGet.mock.calls.filter(([url]) => url === "/v1/channels").length,
      ).toBeGreaterThan(0);
    });
    expect(prefsGets()).toBe(1);
    expect(result.current.data).toEqual([
      { channel_id: "chan-1", level: "mentions" },
    ]);

    // Mark-read invalidates `["channels"]`. Same ids and names → same
    // fingerprint → the prefs query must not fire again.
    channels = [{ id: "chan-1", name: "general" }];
    await queryClient.invalidateQueries({ queryKey: ["channels"] });
    await waitFor(() =>
      expect(
        mockGet.mock.calls.filter(([url]) => url === "/v1/channels").length,
      ).toBeGreaterThan(1),
    );
    expect(prefsGets()).toBe(1);

    // Discord import (or any other-user create) appearing after that refetch.
    channels = [
      { id: "chan-1", name: "general" },
      { id: "chan-alumni", name: "alumni" },
    ];
    await queryClient.invalidateQueries({ queryKey: ["channels"] });
    await waitFor(() => expect(prefsGets()).toBe(2));
    expect(result.current.data).toEqual([
      { channel_id: "chan-1", level: "mentions" },
      { channel_id: "chan-alumni", level: "mentions" },
    ]);

    // Rename onto a name-derived default.
    channels = [
      { id: "chan-1", name: "announcements" },
      { id: "chan-alumni", name: "alumni" },
    ];
    await queryClient.invalidateQueries({ queryKey: ["channels"] });
    await waitFor(() => expect(prefsGets()).toBe(3));
    expect(result.current.data).toEqual([
      { channel_id: "chan-1", level: "all" },
      { channel_id: "chan-alumni", level: "mentions" },
    ]);
  });
});

describe("useSetChannelNotificationLevel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("PUTs the picked level and invalidates the preferences query, not the channel list", async () => {
    const mockPut = vi.fn().mockResolvedValue({
      data: { channel_id: "chan-1", level: "off" },
      error: null,
    });
    const mockClient = { PUT: mockPut };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSetChannelNotificationLevel(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate({ channelId: "chan-1", level: "off" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith(
      "/v1/channels/{id}/notification-preference",
      { params: { path: { id: "chan-1" } }, body: { level: "off" } },
    );
    // Mute state does not live on ["channels"]; nesting the preferences key
    // under that prefix used to refetch on every mark-read. A success here
    // must refresh only the collection this mutation writes.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["channels"],
    });
  });

  it("invalidates the preferences query on error so the control does not keep a level the server never stored", async () => {
    const mockError = new Error("preference write failed");
    const mockPut = vi
      .fn()
      .mockResolvedValue({ data: null, error: mockError });
    const mockClient = { PUT: mockPut };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSetChannelNotificationLevel(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate({ channelId: "chan-1", level: "off" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
    });
  });
});
