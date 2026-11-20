import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useRoles,
  useCreateRole,
  useDeleteRole,
  useUpdateRole,
  useMentionRoles,
} from "./use-roles";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const CHAPTER_ID = "chapter-abc";
// The role hooks are chapter-scoped: they read `useActiveChapterId()`, gate the
// queries on `enabled: !!chapterId`, and invalidate `["roles", chapterId]`. A
// provider without a chapter id leaves that null, so the queries never run and
// the mutations invalidate a key these assertions would not match.
const ROLES_QUERY_KEY = ["roles", CHAPTER_ID];

const createWrapper = (
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = CHAPTER_ID,
) =>
  createHookWrapper({
    queryClient,
    client: mockClient,
    chapterId,
  });

describe("useRoles", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("returns roles when request succeeds", async () => {
    const mockRoles = [
      { id: "role-1", name: "President", permissions: ["members.read"] },
      { id: "role-2", name: "Treasurer", permissions: ["billing.read"] },
    ];
    const mockGet = vi.fn().mockResolvedValue({
      data: mockRoles,
      error: null,
    });

    const { result } = renderHook(() => useRoles(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/roles", {
      signal: expect.any(AbortSignal),
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(mockRoles);
  });

  it("surfaces an error when request fails", async () => {
    const mockError = new Error("Failed to fetch roles");
    const mockGet = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const { result } = renderHook(() => useRoles(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/roles", {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.error).toEqual(mockError);
  });

  // Pins the `enabled: !!chapterId` gate. Without it the hook would fetch
  // during the window before a chapter is selected — no x-chapter-id header,
  // so an unscoped or 403 response cached under ["roles", null]. Every other
  // test here supplies a chapter, so this is the only one that can catch a
  // dropped gate.
  it("does not fetch before a chapter is active", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useRoles(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }, null),
    });

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });

    expect(result.current.isPending).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useMentionRoles", () => {
  it("adds @here after @everyone, on its switch", async () => {
    const queryClient = createTestQueryClient();
    const mockGet = vi.fn().mockResolvedValue({
      data: [
        { role_id: "r1", name: "Officers", color: null, mentionable: true },
        { role_id: "r2", name: "everyone", color: null, mentionable: false },
      ],
      error: undefined,
    });
    const { result } = renderHook(() => useMentionRoles(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/v1/channels/mention-roles", {
      signal: expect.any(AbortSignal),
    });
    expect(
      result.current.data?.map(({ name, mentionable }) => [name, mentionable]),
    ).toEqual([
      ["Officers", true],
      ["everyone", false],
      ["here", false],
    ]);
  });
});

describe("useCreateRole", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.spyOn(queryClient, "invalidateQueries");
  });

  it("creates a role and invalidates queries on success", async () => {
    const mockRole = {
      id: "role-3",
      name: "Secretary",
      permissions: ["members.read"],
    };
    const mockPost = vi.fn().mockResolvedValue({
      data: mockRole,
      error: null,
    });

    const { result } = renderHook(() => useCreateRole(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    const payload = {
      name: "Secretary",
      permissions: ["members.read"],
      display_order: 1,
      color: "#F47FA4" as const,
    };

    const promise = result.current.mutateAsync(payload);
    await expect(promise).resolves.toEqual({ id: "role-3" });

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(mockPost).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ROLES_QUERY_KEY,
      });
    });
  });

  // The test above pins the literal key; this one pins that the key reaches
  // the cached role queries, so a read key renamed away from the `["roles",
  // chapterId]` prefix fails here instead of leaving the list stale (#815).
  it("invalidates the cached role queries it refreshes, by key prefix", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: undefined });
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: { id: "role-3" }, error: null });

    const { result } = renderHook(
      () => ({
        roles: useRoles(),
        mentionRoles: useMentionRoles(),
        create: useCreateRole(),
      }),
      { wrapper: createWrapper(queryClient, { GET: mockGet, POST: mockPost }) },
    );
    await waitFor(() => {
      expect(result.current.roles.isSuccess).toBe(true);
      expect(result.current.mentionRoles.isSuccess).toBe(true);
    });
    const cachedRoleQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.queryKey[0] === "roles");
    expect(cachedRoleQueries()).toHaveLength(2);

    // Stop the refetch so the invalidated flag stays observable. The create
    // waits for that refetch (#5736), so it is left running, not awaited.
    mockGet.mockReturnValue(new Promise(() => {}));
    void result.current.create.mutateAsync({
      name: "Secretary",
      permissions: [],
    });

    await waitFor(() => {
      expect(
        cachedRoleQueries().map((query) => query.state.isInvalidated),
      ).toEqual([true, true]);
    });
  });

  it("creates a role with only required fields and invalidates queries on success", async () => {
    const mockRole = { id: "role-4", name: "Guest", permissions: [] };
    const mockPost = vi.fn().mockResolvedValue({
      data: mockRole,
      error: null,
    });

    const { result } = renderHook(() => useCreateRole(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    const payload = {
      name: "Guest",
      permissions: [],
    };

    const promise = result.current.mutateAsync(payload);
    await expect(promise).resolves.toEqual({ id: "role-4" });

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(mockPost).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ROLES_QUERY_KEY,
      });
    });
  });

  it("surfaces an error when request fails", async () => {
    const mockError = new Error("Failed to create role");
    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const { result } = renderHook(() => useCreateRole(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    const payload = {
      name: "Secretary",
      permissions: ["members.read"],
    };

    const promise = result.current.mutateAsync(payload);
    await expect(promise).rejects.toThrow(mockError);

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(mockPost).toHaveBeenCalledTimes(1);

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});

// #3485: the roster's `role_color` is computed from role colors and order, so
// a role edit or delete must refresh it or chat keeps painting the old color.
describe("role edits refresh the roster's role colors", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.spyOn(queryClient, "invalidateQueries");
  });

  it("invalidates the roster after a role update", async () => {
    const mockPatch = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useUpdateRole(), {
      wrapper: createWrapper(queryClient, { PATCH: mockPatch }),
    });

    await result.current.mutateAsync({
      id: "role-1",
      body: { color: "#5CC8F0" },
    });

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["members", CHAPTER_ID, "roster"],
      });
    });
  });

  // A delete strips the role off its holders (#4547), so every members query
  // refreshes: the prefix covers the roster, the channel list and the
  // Members list, which would otherwise send the deleted id back.
  it("invalidates every members query after a role delete", async () => {
    const mockDelete = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useDeleteRole(), {
      wrapper: createWrapper(queryClient, { DELETE: mockDelete }),
    });

    await result.current.mutateAsync("role-1");

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["members", CHAPTER_ID],
      });
    });
  });
});
