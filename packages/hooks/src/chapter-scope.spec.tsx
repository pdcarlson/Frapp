/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { resolveChapterScope, useChapterScope } from "./chapter-scope";
import {
  useCategories,
  useChannelLatestMessages,
  useChannelNotificationPreferences,
  useChannels,
  useChannelUnreadCounts,
} from "./use-chat";
import { FrappClientProvider } from "./use-frapp-client";
import { useTasks } from "./use-tasks";

/**
 * #4094: a signed-in user with no membership, on mobile's cold launch through
 * an invite link (chat home paints for a frame before `/join`) and on web's
 * `/chat`, sent the channel, task and notification-preference reads with no
 * chapter, and the API refused each with `400 chapter.context.required`.
 */

/** Every read chat home and web's chat shell make with no gate of their own. */
const CHAPTER_SCOPED_PATHS = [
  "/v1/channels",
  "/v1/channels/unread",
  "/v1/channels/latest",
  "/v1/channels/categories/list",
  "/v1/channels/notification-preferences",
  "/v1/tasks",
];

function useChatHomeReads() {
  useChannels();
  useChannelUnreadCounts();
  useChannelLatestMessages();
  useCategories();
  useChannelNotificationPreferences();
  useTasks();
}

describe("resolveChapterScope", () => {
  it("is a chapter as soon as there is a chapter id, list or not", () => {
    expect(
      resolveChapterScope({
        chapterId: "chapter-1",
        memberships: undefined,
        membershipsFailed: false,
      }),
    ).toBe("chapter");
  });

  it("is a chapter for a listed membership with no claim (server resolves a sole one)", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: [{ chapter_id: "chapter-1" }],
        membershipsFailed: false,
      }),
    ).toBe("chapter");
  });

  it("is none once the list answers empty", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: [],
        membershipsFailed: false,
      }),
    ).toBe("none");
  });

  it("is none for two memberships and no chapter id, which the server can't pick between", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: [{ chapter_id: "chapter-1" }, { chapter_id: "chapter-2" }],
        membershipsFailed: false,
      }),
    ).toBe("none");
  });

  it("keeps an answered empty list when a refetch of it fails", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: [],
        membershipsFailed: true,
      }),
    ).toBe("none");
  });

  it("is resolving until the list answers", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: undefined,
        membershipsFailed: false,
      }),
    ).toBe("resolving");
  });

  it("fails open when the list read failed, so an outage can't blank chat", () => {
    expect(
      resolveChapterScope({
        chapterId: null,
        memberships: undefined,
        membershipsFailed: true,
      }),
    ).toBe("chapter");
  });
});

describe("chapter-scoped reads with no chapter (#4094)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  /** A client that answers `/v1/chapters` with `memberships` and records every path. */
  function fakeClient(memberships: unknown[] | "fail") {
    const GET = vi.fn(async (path: string) => {
      if (path === "/v1/chapters") {
        return memberships === "fail"
          ? { data: undefined, error: { message: "down" } }
          : { data: memberships, error: undefined };
      }
      return { data: [], error: undefined };
    });
    return { GET };
  }

  function wrapper(client: { GET: unknown }, chapterId: string | null) {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as unknown as ReturnType<typeof createFrappClient>}
        chapterId={chapterId}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "ChapterScopeWrapper";
    return Wrapper;
  }

  function requestedPaths(client: { GET: ReturnType<typeof vi.fn> }) {
    return client.GET.mock.calls.map((call) => call[0] as string);
  }

  it("sends none of them for a user with no membership", async () => {
    const client = fakeClient([]);
    const scope = renderHook(() => useChapterScope(), {
      wrapper: wrapper(client, null),
    });
    renderHook(() => useChatHomeReads(), { wrapper: wrapper(client, null) });

    await waitFor(() => expect(scope.result.current).toBe("none"));
    // Let anything that was going to fire on the settled list do so.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const paths = requestedPaths(client);
    expect(paths).toContain("/v1/chapters");
    for (const path of CHAPTER_SCOPED_PATHS) {
      expect(paths).not.toContain(path);
    }
  });

  it("sends nothing at all while the caller is disabled (mounted above the auth gate)", async () => {
    const client = fakeClient([]);
    renderHook(
      () => {
        useChannels({ enabled: false });
        useChannelUnreadCounts({ enabled: false });
      },
      { wrapper: wrapper(client, null) },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.GET).not.toHaveBeenCalled();
  });

  it("sends them for a claim-less member the chapters list shows", async () => {
    const client = fakeClient([{ chapter_id: "chapter-1" }]);
    renderHook(() => useChatHomeReads(), { wrapper: wrapper(client, null) });

    await waitFor(() => {
      const paths = requestedPaths(client);
      for (const path of CHAPTER_SCOPED_PATHS) {
        expect(paths).toContain(path);
      }
    });
  });

  it("sends them once the user joins a chapter (the invite path)", async () => {
    let memberships: unknown[] = [];
    const GET = vi.fn(async (path: string) =>
      path === "/v1/chapters"
        ? { data: memberships, error: undefined }
        : { data: [], error: undefined },
    );
    const client = { GET };
    const scope = renderHook(() => useChapterScope(), {
      wrapper: wrapper(client, null),
    });
    renderHook(() => useChatHomeReads(), { wrapper: wrapper(client, null) });
    await waitFor(() => expect(scope.result.current).toBe("none"));
    expect(requestedPaths(client)).not.toContain("/v1/channels");

    // Redeeming an invite invalidates `["chapters"]` (`useRedeemInvite`).
    memberships = [{ chapter_id: "chapter-1" }];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["chapters"] });
    });

    await waitFor(() => {
      const paths = requestedPaths(client);
      for (const path of CHAPTER_SCOPED_PATHS) {
        expect(paths).toContain(path);
      }
    });
  });

  it("sends none of them for a member of two chapters with no chapter id", async () => {
    const client = fakeClient([
      { chapter_id: "chapter-1" },
      { chapter_id: "chapter-2" },
    ]);
    const scope = renderHook(() => useChapterScope(), {
      wrapper: wrapper(client, null),
    });
    renderHook(() => useChatHomeReads(), { wrapper: wrapper(client, null) });

    await waitFor(() => expect(scope.result.current).toBe("none"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const path of CHAPTER_SCOPED_PATHS) {
      expect(requestedPaths(client)).not.toContain(path);
    }
  });

  it("sends them when the chapters list fails, leaving the server to decide", async () => {
    const client = fakeClient("fail");
    renderHook(() => useChannels(), { wrapper: wrapper(client, null) });

    await waitFor(() =>
      expect(requestedPaths(client)).toContain("/v1/channels"),
    );
  });

  it("sends them with a chapter id without reading the chapters list first", async () => {
    const client = fakeClient([]);
    renderHook(() => useChatHomeReads(), {
      wrapper: wrapper(client, "chapter-1"),
    });

    await waitFor(() => {
      const paths = requestedPaths(client);
      for (const path of CHAPTER_SCOPED_PATHS) {
        expect(paths).toContain(path);
      }
    });
    expect(requestedPaths(client)).not.toContain("/v1/chapters");
  });
});
