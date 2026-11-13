import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_LIST_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
  useChannelUnreadCounts,
  useMarkChannelRead,
  useMarkMessageUnread,
  markChannelReadMutationKey,
  useLeaveChannel,
  useSetChannelDisplayLock,
  canSetChannelDisplayLock,
  useAuthorAvatars,
  useChannelNotificationPreferences,
  useSetChannelNotificationLevel,
  useUploadSignedUrl,
  useForwardMessage,
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
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
      // A member in a chapter: the channel reads wait for one (#4094,
      // `chapter-scope.spec.tsx` covers the no-chapter path).
      chapterId="chapter-1"
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

describe("useMarkMessageUnread (#3723)", () => {
  it("waits for a read stamp in flight, then moves the cursor and refreshes the badges", async () => {
    const queryClient = createTestQueryClient();
    const order: string[] = [];
    let finishRead!: () => void;
    const mockPost = vi.fn((path: string) => {
      order.push(path);
      if (path === "/v1/channels/{id}/read") {
        return new Promise((resolve) => {
          finishRead = () =>
            resolve({ data: {}, response: { ok: true, status: 200 } });
        });
      }
      return Promise.resolve({ data: {}, response: { ok: true, status: 201 } });
    });
    const wrapper = createWrapper(queryClient, { POST: mockPost });
    const read = renderHook(() => useMarkChannelRead(), { wrapper });
    const unread = renderHook(() => useMarkMessageUnread(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    read.result.current.mutate("chan-1");
    await waitFor(() => expect(order).toEqual(["/v1/channels/{id}/read"]));
    unread.result.current.mutate("msg-1");
    // Still holding: the stamp hasn't landed.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(order).toEqual(["/v1/channels/{id}/read"]);

    finishRead();
    await waitFor(() => expect(unread.result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenLastCalledWith(
      "/v1/channels/messages/{messageId}/unread",
      { params: { path: { messageId: "msg-1" } } },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["channels"] });
  });
});

describe("useMarkChannelRead", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts to the channel's read endpoint and re-reads the summaries and channel metadata, not the per-message reads", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: undefined,
      response: { ok: true, status: 200 },
    });
    const mockClient = { POST: mockPost };
    // Everything that lives under the `["channels"]` prefix on an open chat.
    const keys = {
      unread: CHANNEL_UNREAD_COUNTS_KEY,
      latest: CHANNEL_LATEST_MESSAGES_KEY,
      list: CHANNEL_LIST_KEY,
      categories: ["channels", "categories"],
      detail: ["channels", "chan-1"],
      otherDetail: ["channels", "chan-2"],
      pins: ["channels", "chan-1", "pins"],
      avatars: ["channels", "chan-1", "avatars", "x"],
      attachments: ["channels", "chan-1", "messages", "m-1", "attachments"],
    } as const;
    for (const key of Object.values(keys)) queryClient.setQueryData(key, []);

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith("/v1/channels/{id}/read", {
      params: { path: { id: "chan-1" } },
    });
    // The summaries and the channel metadata are re-read: opening a channel
    // is when the rail catches up with other members' channel changes. The
    // per-message reads under the prefix are not: refetching them on every
    // open (a signed URL re-minted per attachment) was part of the open
    // burst (#4709).
    const invalidated = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [
        name,
        queryClient.getQueryState(key)?.isInvalidated,
      ]),
    );
    expect(invalidated).toEqual({
      unread: true,
      latest: true,
      list: true,
      categories: true,
      detail: true,
      otherDetail: false,
      pins: false,
      avatars: false,
      attachments: false,
    });
  });

  it("surfaces an error without invalidating anything", async () => {
    const body = {
      statusCode: 403,
      error: "Forbidden",
      message: "Not a member",
    };
    const mockPost = vi.fn().mockResolvedValue({
      data: undefined,
      error: body,
      response: { ok: false, status: 403 },
    });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(body);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("clears the channel's cached chat notifications and refetches the inbox only when it showed one (#3788)", async () => {
    // Seeded entries no component observes need a gc window to survive.
    queryClient.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity },
    });
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: undefined,
      response: { ok: true, status: 200 },
    });
    const listKey = ["notifications", "chapter-1", undefined];
    queryClient.setQueryData(listKey, [
      {
        id: "n-1",
        read_at: null,
        data: { target: { screen: "chat", channelId: "chan-1" } },
      },
    ]);
    // Shares the `notifications` prefix, but a read can't change it.
    const prefsKey = ["notifications", "preferences", "chapter-1"];
    queryClient.setQueryData(prefsKey, []);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    result.current.mutate("chan-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      (queryClient.getQueryData(listKey) as { read_at: string | null }[])[0]
        ?.read_at,
    ).toEqual(expect.any(String));
    // The inbox list is refetched; preferences, which share the prefix, aren't.
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(prefsKey)?.isInvalidated).toBe(false);

    invalidateSpy.mockClear();
    result.current.mutate("chan-1");
    // The second success is the one that just invalidated the unread counts.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["channels", "latest"],
        exact: true,
      }),
    );
    // Nothing left to clear: the read's own five keys (summaries, list,
    // categories, detail), no notification-list refetch.
    expect(invalidateSpy).toHaveBeenCalledTimes(5);
    expect(queryClient.getQueryState(prefsKey)?.isInvalidated).toBe(false);
  });

  // openapi-fetch gives an empty-bodied 5xx no `error` at all. Read off
  // `error`, the stamp that never landed looked like one that did, and mobile's
  // retry (#3747) never ran.
  it("fails an empty-bodied 5xx, with its status, rather than reading it as a stamp", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { ok: false, status: 503 },
    });
    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 503 });
  });

  // Mobile's retry default is registered by this key; without it the hook
  // silently falls back to `retry: 0`.
  it("carries markChannelReadMutationKey", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { success: true },
      error: undefined,
      response: { ok: true, status: 200 },
    });
    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation?.options.mutationKey).toEqual(markChannelReadMutationKey);
  });
});

// #2303: the hide lands through the list refetch, since a hidden DM stays in
// `GET /v1/channels` flagged `hidden` rather than being removed from it.
describe("useSetChannelDisplayLock (#3787)", () => {
  it("puts the lock and refetches the channel list", async () => {
    const queryClient = createTestQueryClient();
    const mockPut = vi
      .fn()
      .mockResolvedValue({
        data: { id: "c-1", display_locked: true },
        error: null,
      });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetChannelDisplayLock(), {
      wrapper: createWrapper(queryClient, { PUT: mockPut }),
    });

    await result.current.mutateAsync({ id: "c-1", locked: true });

    expect(mockPut).toHaveBeenCalledWith("/v1/channels/{id}/display-lock", {
      params: { path: { id: "c-1" } },
      body: { display_locked: true },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["channels"] });
  });
});

describe("canSetChannelDisplayLock (#3787)", () => {
  const channel = { type: "PUBLIC", created_by: "u-creator" };

  it("lets the creator and a channels:manage holder set it", () => {
    expect(canSetChannelDisplayLock(channel, "u-creator", [])).toBe(true);
    expect(canSetChannelDisplayLock(channel, "u-x", ["channels:manage"])).toBe(
      true,
    );
    expect(canSetChannelDisplayLock(channel, "u-x", ["*"])).toBe(true);
  });

  it("refuses anyone else, a channel with no creator, and every DM", () => {
    expect(canSetChannelDisplayLock(channel, "u-x", ["members:view"])).toBe(
      false,
    );
    expect(
      canSetChannelDisplayLock({ type: "PUBLIC", created_by: null }, null, []),
    ).toBe(false);
    expect(
      canSetChannelDisplayLock(
        { type: "DM", created_by: "u-creator" },
        "u-creator",
        ["*"],
      ),
    ).toBe(false);
  });
});

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

  it("refetches the inbox when it shows an unread chat row for the hidden DM (#3788)", async () => {
    queryClient.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity },
    });
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { success: true }, error: null });
    const listKey = ["notifications", "chapter-1", undefined];
    const rows = [
      {
        id: "n-1",
        read_at: null,
        data: { target: { screen: "chat", channelId: "dm-1" } },
      },
    ];
    queryClient.setQueryData(listKey, rows);
    const { result } = renderHook(() => useLeaveChannel(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await result.current.mutateAsync("dm-1");

    // Refetched, not rewritten: the server decides what a leave clears.
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(listKey)).toBe(rows);
  });

  it("surfaces an error without invalidating anything", async () => {
    const mockError = new Error("leave failed");
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: null, error: mockError });
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

  it("never signs a linked row's Discord avatar, but still signs that path for an unlinked row (#2878)", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { "path/a": "https://signed/a" },
      error: null,
    });
    const mockClient = { POST: mockPost };
    const messages = [
      { id: "msg-1", sender_id: "user-jake", author_avatar_path: "path/a" },
      { id: "msg-2", sender_id: "user-jake", author_avatar_path: "path/b" },
      { id: "msg-3", sender_id: null, author_avatar_path: "path/a" },
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
        body: { message_ids: ["msg-3"] },
      },
    );
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
    expect(channelSetFingerprint([{ id: "a", name: "general" }])).not.toBe(
      channelSetFingerprint([
        { id: "a", name: "general" },
        { id: "b", name: "alumni" },
      ]),
    );
    expect(channelSetFingerprint([{ id: "a", name: "general" }])).not.toBe(
      channelSetFingerprint([{ id: "a", name: "announcements" }]),
    );
  });

  it("changes with every field the server default reads (#2771)", () => {
    const base = {
      id: "a",
      name: "announcements",
      type: "PUBLIC",
      is_read_only: true,
      default_notification_level: null,
    };
    const print = channelSetFingerprint([base]);
    for (const change of [
      { is_read_only: false },
      { type: "PRIVATE" },
      { default_notification_level: "off" },
    ]) {
      expect(channelSetFingerprint([{ ...base, ...change }])).not.toBe(print);
    }
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

    // Mark-read re-reads the channel list. Same ids and names → same
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
    const mockPut = vi.fn().mockResolvedValue({ data: null, error: mockError });
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

describe("useUploadSignedUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs with the type the URL was minted for, not the browser's empty one", async () => {
    // A legacy .doc usually arrives with `type: ""`. The chat bucket's MIME
    // allowlist rejects an empty Content-Type, so the resolved type the
    // composer requested the URL with is the one that must go on the PUT.
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["bytes"], "minutes.doc", { type: "" });

    const { result } = renderHook(() => useUploadSignedUrl(), {
      wrapper: createWrapper(createTestQueryClient(), {}),
    });
    await result.current.mutateAsync({
      signedUrl: "https://storage.example/put",
      file,
      contentType: "application/msword",
    });

    // No x-upsert: every chat upload is minted a fresh path.
    expect(fetchMock).toHaveBeenCalledWith("https://storage.example/put", {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/msword" },
    });
  });
});

describe("useForwardMessage (#4864)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  const created = { id: "m2", channel_id: "chan-dest", content: "" };

  it("posts the destination, the comment and the caller's key, then re-reads the two summaries exactly", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: created,
      error: undefined,
      response: { ok: true, status: 201 },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useForwardMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    const row = await result.current.mutateAsync({
      messageId: "m1",
      channelId: "chan-dest",
      content: "look",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
    });

    expect(row).toEqual(created);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/forward",
      {
        params: { path: { messageId: "m1" } },
        body: {
          channel_id: "chan-dest",
          content: "look",
          client_message_id: "11111111-1111-4111-8111-111111111111",
        },
      },
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: CHANNEL_LATEST_MESSAGES_KEY,
        exact: true,
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    // Never the prefix, which would re-read the list and every channel.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["channels"] });
  });

  it("sends no content for a blank comment and draws a key when none is given", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: created,
      error: undefined,
      response: { ok: true, status: 201 },
    });
    const { result } = renderHook(() => useForwardMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await result.current.mutateAsync({
      messageId: "m1",
      channelId: "chan-dest",
      content: "   ",
    });

    const body = mockPost.mock.calls[0]![1].body;
    expect(body).not.toHaveProperty("content");
    expect(body.client_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("throws with the status on a refusal and re-reads nothing", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "Not allowed" },
      response: { ok: false, status: 403 },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useForwardMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await expect(
      result.current.mutateAsync({ messageId: "m1", channelId: "chan-dest" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
