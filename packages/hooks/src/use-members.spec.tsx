import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChapterRoster,
  useMemberDisplayNames,
  useMembers,
  useMemberSearch,
} from "./use-members";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

const MEMBERS_ENDPOINT = "/v1/members";
const CHAPTER_ID = "chapter-abc";

// The member hooks read two exports of this module — `useFrappClient` for the
// transport and `useActiveChapterId` for the per-chapter query key and the
// `enabled` gate. Spread the real module rather than listing exports: a bare
// factory replaces the module wholesale, so the day a hook reaches for a third
// export every test here fails with a stack pointing at use-members.ts instead
// of at this mock. That is exactly how these specs broke when
// `useActiveChapterId` was introduced.
vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
  useActiveChapterId: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "UseMembersTestWrapper";
  return Wrapper;
}

describe("useMembers", () => {
  let queryClient: QueryClient;
  const mockUseFrappClient = vi.mocked(useFrappClient);
  const mockUseActiveChapterId = vi.mocked(useActiveChapterId);

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    mockUseActiveChapterId.mockReturnValue(CHAPTER_ID);
  });

  it("returns members when the API request succeeds", async () => {
    const members = [
      { id: "member-1", chapter_id: "chapter-1" },
      { id: "member-2", chapter_id: "chapter-1" },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: members, error: null });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith(MEMBERS_ENDPOINT);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(members);

    const secondRender = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(secondRender.result.current.isSuccess).toBe(true);
    });

    // useMembers sets staleTime to 60s, so remounting immediately should reuse
    // fresh cache data instead of refetching.
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors when the members request fails", async () => {
    const mockError = new Error("Failed to fetch members");
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith(MEMBERS_ENDPOINT);
    expect(result.current.error).toBe(mockError);
  });

  // Pins the `enabled: !!chapterId` gate. `activeChapterId` is null during
  // first paint and chapter-store rehydration, and the SDK omits the
  // x-chapter-id header when it is falsy — so a dropped gate means an
  // unscoped/403 request cached under ["members", null] on every hard reload.
  it("does not fetch before a chapter is active", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    mockUseActiveChapterId.mockReturnValue(null);

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });

    expect(result.current.isPending).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useMemberSearch", () => {
  let queryClient: QueryClient;
  const mockUseFrappClient = vi.mocked(useFrappClient);
  const mockUseActiveChapterId = vi.mocked(useActiveChapterId);

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    mockUseActiveChapterId.mockReturnValue(CHAPTER_ID);
  });

  it("returns members matching the query when the API request succeeds", async () => {
    const query = "test";
    const members = [
      { id: "member-1", name: "Test User 1" },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: members, error: null });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberSearch(query), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/search", {
      params: { query: { q: query } },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(members);
  });

  it("is disabled and does not fetch when the query is empty", async () => {
    const query = "";
    const mockGet = vi.fn();

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberSearch(query), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.status).toBe("pending");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// The roster projection is what the chat surface resolves names from. It exists
// so a display concern never pulls MemberProfile, so the assertions here are
// about which endpoint is called and how an unset name degrades.
describe("useChapterRoster / useMemberDisplayNames", () => {
  const ROSTER_ENDPOINT = "/v1/members/roster";
  let queryClient: QueryClient;
  const mockUseFrappClient = vi.mocked(useFrappClient);
  const mockUseActiveChapterId = vi.mocked(useActiveChapterId);

  const roster = [
    { user_id: "user-1", display_name: "Marcus Reid", avatar_url: null },
    { user_id: "user-blank", display_name: "", avatar_url: null },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    mockUseActiveChapterId.mockReturnValue(CHAPTER_ID);
  });

  it("reads the narrow roster endpoint, not the member list", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: roster, error: null });
    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useChapterRoster(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(ROSTER_ENDPOINT);
    expect(mockGet).not.toHaveBeenCalledWith(MEMBERS_ENDPOINT);
    expect(result.current.data).toEqual(roster);
  });

  it("does not fetch before a chapter is active", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    mockUseActiveChapterId.mockReturnValue(null);
    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useChapterRoster(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(mockGet).not.toHaveBeenCalled();
  });

  it("resolves ids to names and treats an empty name as unresolved", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: roster, error: null });
    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.nameFor("user-1")).toBe("Marcus Reid");
    // display_name is NOT NULL DEFAULT '', so '' must not render as a name.
    expect(result.current.nameFor("user-blank")).toBeNull();
    expect(result.current.nameFor("user-unknown")).toBeNull();
    expect(result.current.byId["user-1"]).toBe("Marcus Reid");
  });

  it("surfaces an API error and resolves nothing", async () => {
    const mockError = { message: "boom" };
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.nameFor("user-1")).toBeNull();
  });
});
