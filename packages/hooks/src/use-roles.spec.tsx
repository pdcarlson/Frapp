import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useRoles, useCreateRole } from "./use-roles";
import { FrappClientProvider } from "./use-frapp-client";

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
) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
};

describe("useRoles", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
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

    expect(mockGet).toHaveBeenCalledWith("/v1/roles");
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

    expect(mockGet).toHaveBeenCalledWith("/v1/roles");
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

describe("useCreateRole", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.spyOn(queryClient, "invalidateQueries");
  });

  it("creates a role and invalidates queries on success", async () => {
    const mockRole = { id: "role-3", name: "Secretary", permissions: ["members.read"] };
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
      color: "#000000",
    };

    const promise = result.current.mutateAsync(payload);
    await expect(promise).resolves.toEqual(mockRole);

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(mockPost).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ROLES_QUERY_KEY,
      });
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
    await expect(promise).resolves.toEqual(mockRole);

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
