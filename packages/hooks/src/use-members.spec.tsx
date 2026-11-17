import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChapterRoster,
  useCorrectMemberProfile,
  useMemberDisplayNames,
  useMembers,
  useMemberSearch,
  resetRosterCatchUpForTests,
  useRemoveMember,
  useRosterCatchUp,
  useUpdateMemberRoles,
} from "./use-members";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { createHookWrapper } from "./test-utils";
import { memberAvatarTint, memberHashHue } from "./member-avatar-color";

const MEMBERS_ENDPOINT = "/v1/members";
const CHAPTER_ID = "chapter-abc";

// What the next `createWrapper` hands the real `FrappClientProvider`: the
// stubbed transport and the active chapter (the per-chapter query key and the
// `enabled` gate). Each test sets both before it renders.
let stubClient: unknown;
let activeChapterId: string | null;

function createWrapper(queryClient: QueryClient) {
  return createHookWrapper({
    client: stubClient,
    queryClient,
    chapterId: activeChapterId,
    displayName: "UseMembersTestWrapper",
  });
}

describe("useMembers", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    activeChapterId = CHAPTER_ID;
  });

  it("returns members when the API request succeeds", async () => {
    const members = [
      { id: "member-1", chapter_id: "chapter-1" },
      { id: "member-2", chapter_id: "chapter-1" },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: members, error: null });

    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith(MEMBERS_ENDPOINT, {
      signal: expect.any(AbortSignal),
    });
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

    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMembers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith(MEMBERS_ENDPOINT, {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.error).toBe(mockError);
  });

  // Pins the `enabled: !!chapterId` gate. `activeChapterId` is null during
  // first paint and chapter-store rehydration, and the SDK omits the
  // x-chapter-id header when it is falsy — so a dropped gate means an
  // unscoped/403 request cached under ["members", null] on every hard reload.
  it("does not fetch before a chapter is active", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    activeChapterId = null;

    stubClient = {
      GET: mockGet,
    };

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

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    activeChapterId = CHAPTER_ID;
  });

  it("returns members matching the query when the API request succeeds", async () => {
    const query = "test";
    const members = [{ id: "member-1", name: "Test User 1" }];
    const mockGet = vi.fn().mockResolvedValue({ data: members, error: null });

    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberSearch(query), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/search", {
      signal: expect.any(AbortSignal),
      params: { query: { q: query } },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(members);
  });

  it("is disabled and does not fetch when the query is empty", async () => {
    const query = "";
    const mockGet = vi.fn();

    stubClient = {
      GET: mockGet,
    };

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

  const roster = [
    { user_id: "user-1", display_name: "Marcus Reid", avatar_url: null },
    { user_id: "user-blank", display_name: "", avatar_url: null },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    activeChapterId = CHAPTER_ID;
  });

  it("reads the narrow roster endpoint, not the member list", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: roster, error: null });
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useChapterRoster(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(ROSTER_ENDPOINT, {
      signal: expect.any(AbortSignal),
    });
    expect(mockGet).not.toHaveBeenCalledWith(
      MEMBERS_ENDPOINT,
      expect.anything(),
    );
    expect(result.current.data).toEqual(roster);
  });

  it("does not fetch before a chapter is active", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    activeChapterId = null;
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useChapterRoster(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(mockGet).not.toHaveBeenCalled();
  });

  it("stays pending, never settling, while there is no active chapter", async () => {
    // The read is `enabled: !!chapterId`, so a disabled query sits at
    // `status: "pending"` indefinitely. Surfaces must degrade to a fallback
    // label rather than block on this, or a chapterless visitor sees a spinner
    // that never resolves — pinned here because it is a framework behaviour a
    // consumer's own mock would otherwise be free to contradict.
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    activeChapterId = null;
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.nameFor("user-1")).toBeNull());

    expect(result.current.isPending).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("resolves ids to the signed photo from the same roster read (#732)", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "user-1",
          display_name: "Marcus Reid",
          avatar_url: "https://signed/photo",
        },
        { user_id: "user-2", display_name: "Dana Lowe", avatar_url: null },
      ],
      error: null,
    });
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(result.current.avatarFor("user-1")).toBe("https://signed/photo"),
    );
    expect(result.current.avatarFor("user-2")).toBeNull();
    expect(result.current.avatarFor("unknown")).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("resolves ids to a palette role color, dropping off-palette values (#3485)", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "user-1",
          display_name: "A",
          avatar_url: null,
          role_color: "#6FD08C",
        },
        {
          user_id: "user-2",
          display_name: "B",
          avatar_url: null,
          role_color: null,
        },
        {
          user_id: "user-3",
          display_name: "C",
          avatar_url: null,
          role_color: "#FFD700",
        },
      ],
      error: null,
    });
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(result.current.roleColorFor("user-1")).toBe("#6FD08C"),
    );
    expect(result.current.roleColorFor("user-2")).toBeNull();
    expect(result.current.roleColorFor("user-3")).toBeNull();
    expect(result.current.roleColorFor("unknown")).toBeNull();

    // The avatar takes the same color the name does (#3860): an officer's
    // role color, else the stable hashed hue (an off-palette value included).
    expect(result.current.avatarTintFor("user-1")).toEqual(
      memberAvatarTint("#6FD08C"),
    );
    expect(result.current.avatarTintFor("user-2")).toEqual(
      memberAvatarTint(memberHashHue("user-2")),
    );
    expect(result.current.avatarTintFor("user-3")).toEqual(
      memberAvatarTint(memberHashHue("user-3")),
    );
  });

  it("re-runs the roster read through refetch", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: roster, error: null });
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    result.current.refetch();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it("resolves ids to names and treats an empty name as unresolved", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: roster, error: null });
    stubClient = {
      GET: mockGet,
    };

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
    stubClient = {
      GET: mockGet,
    };

    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.nameFor("user-1")).toBeNull();
  });
});

describe("typistLabelFor (#4493)", () => {
  it("names, falls back for a nameless member, and holds back an unknown id", async () => {
    activeChapterId = CHAPTER_ID;
    let settle: (value: unknown) => void = () => {};
    const get = vi.fn(() => new Promise((resolve) => (settle = resolve)));
    stubClient = {
      GET: get,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useMemberDisplayNames(), {
      wrapper: createWrapper(queryClient),
    });

    // No roster yet: everyone reads as the timeline's fallback.
    expect(result.current.typistLabelFor("user-1")).toBe("Member user-1");
    settle({
      data: [
        { user_id: "user-1", display_name: "Marcus Reid", avatar_url: null },
        { user_id: "user-blank", display_name: "  ", avatar_url: null },
      ],
      error: null,
    });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.typistLabelFor("user-1")).toBe("Marcus Reid");
    expect(result.current.typistLabelFor("user-blank")).toBe("Member user-b");
    expect(result.current.typistLabelFor("stranger")).toBeNull();
  });
});

// A member who joined after the roster loaded, typing or posting in chat, is
// named once the roster is re-read, instead of `Member 2f4a1c` or an unnamed
// typing line (2026-11-12).
describe("useRosterCatchUp", () => {
  let queryClient: QueryClient;
  const first = [
    { user_id: "user-1", display_name: "Marcus Reid", avatar_url: null },
  ];
  const after = [
    ...first,
    { user_id: "new-joiner", display_name: "Alex Kim", avatar_url: null },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    activeChapterId = CHAPTER_ID;
    resetRosterCatchUpForTests();
  });

  function mountWith(get: ReturnType<typeof vi.fn>, ids: string[]) {
    stubClient = {
      GET: get,
    };
    return renderHook(
      ({ wanted }: { wanted: string[] }) => {
        useRosterCatchUp(
          wanted,
          wanted.map((id) => ({ sender_id: id })),
        );
        return useMemberDisplayNames();
      },
      { wrapper: createWrapper(queryClient), initialProps: { wanted: ids } },
    );
  }

  it("re-reads the roster for an id it lacks, and names them", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValue({ data: after, error: null });
    const { result } = mountWith(get, ["user-1", "new-joiner"]);

    await waitFor(() => {
      expect(result.current.nameFor("new-joiner")).toBe("Alex Kim");
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("asks only once for an id the roster never gains", async () => {
    const get = vi.fn().mockResolvedValue({ data: first, error: null });
    const { rerender } = mountWith(get, ["gone-member"]);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    rerender({ wanted: ["gone-member", "user-1"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("asks once per id across surfaces and remounts", async () => {
    const get = vi.fn().mockResolvedValue({ data: first, error: null });
    const one = mountWith(get, ["gone-member"]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    one.unmount();
    mountWith(get, ["gone-member"]);
    mountWith(get, ["gone-member"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("asks again after a re-read that failed", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("503") })
      .mockResolvedValue({ data: after, error: null });
    const { result, rerender } = mountWith(get, ["new-joiner"]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    // Not in a loop against the failing API.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(get).toHaveBeenCalledTimes(2);
    // The next change on the surface (a new message, a typist) tries again.
    rerender({ wanted: ["new-joiner", "user-1"] });
    await waitFor(() => {
      expect(result.current.nameFor("new-joiner")).toBe("Alex Kim");
    });
  });

  it("never re-reads for known members or the system sender", async () => {
    const get = vi.fn().mockResolvedValue({ data: first, error: null });
    const { result } = mountWith(get, ["user-1", SYSTEM_SENDER_ID]);

    await waitFor(() => expect(result.current.hasData).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

// #2484: the directory's Actives tab filters `GET /v1/members` and its Alumni
// tab is `GET /v1/alumni`. A write that can move a member between them has to
// refetch both, or the member sits on neither tab until the alumni cache ages.
describe("membership writes refetch the alumni list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeChapterId = CHAPTER_ID;
  });

  function invalidatedKeys(queryClient: QueryClient) {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    return () => spy.mock.calls.map(([filters]) => filters?.queryKey);
  }

  it("useUpdateMemberRoles invalidates members and alumni", async () => {
    const queryClient = new QueryClient();
    const keys = invalidatedKeys(queryClient);
    stubClient = {
      PATCH: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };

    const { result } = renderHook(() => useUpdateMemberRoles(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync({ id: "member-1", role_ids: ["alumni"] });

    await waitFor(() =>
      expect(keys()).toEqual(
        expect.arrayContaining([
          ["members", CHAPTER_ID],
          ["alumni", CHAPTER_ID],
        ]),
      ),
    );
  });

  it("useUpdateMemberRoles re-reads the member and the roles after a 409, and nothing after a 400 (#4830)", async () => {
    const queryClient = new QueryClient();
    const keys = invalidatedKeys(queryClient);
    const PATCH = vi.fn();
    stubClient = {
      PATCH,
    };
    const { result } = renderHook(() => useUpdateMemberRoles(), {
      wrapper: createWrapper(queryClient),
    });

    PATCH.mockResolvedValueOnce({
      data: undefined,
      error: { statusCode: 400 },
    });
    await expect(
      result.current.mutateAsync({ id: "member-1", role_ids: ["gone"] }),
    ).rejects.toBeTruthy();
    expect(keys()).toEqual([]);

    PATCH.mockResolvedValueOnce({
      data: undefined,
      error: { statusCode: 409 },
    });
    await expect(
      result.current.mutateAsync({ id: "member-1", role_ids: ["r1"] }),
    ).rejects.toBeTruthy();
    await waitFor(() =>
      expect(keys()).toEqual(
        expect.arrayContaining([
          ["members", CHAPTER_ID],
          ["roles", CHAPTER_ID],
        ]),
      ),
    );
  });

  it("useCorrectMemberProfile refetches every read showing the name, not the viewer's own", async () => {
    const queryClient = new QueryClient();
    const keys = invalidatedKeys(queryClient);
    const PATCH = vi.fn().mockResolvedValue({ data: {}, error: null });
    stubClient = {
      PATCH,
    };

    const { result } = renderHook(() => useCorrectMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync({ id: "member-1", display_name: "Ada" });

    expect(PATCH).toHaveBeenCalledWith("/v1/members/{id}/profile", {
      params: { path: { id: "member-1" } },
      body: { display_name: "Ada" },
    });
    expect(keys()).toEqual(
      expect.arrayContaining([["members"], ["alumni"], ["activity-feed"]]),
    );
    expect(keys()).not.toContainEqual(["user", "me"]);
  });

  it("useRemoveMember invalidates members, alumni and the leaderboard", async () => {
    const queryClient = new QueryClient();
    const keys = invalidatedKeys(queryClient);
    stubClient = {
      DELETE: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };

    const { result } = renderHook(() => useRemoveMember(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync("member-1");

    await waitFor(() =>
      expect(keys()).toEqual(
        expect.arrayContaining([
          ["members", CHAPTER_ID],
          ["alumni", CHAPTER_ID],
          ["points"],
        ]),
      ),
    );
  });
});
