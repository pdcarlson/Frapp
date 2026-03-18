import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMembers, useMemberSearch } from "./use-members";
import { useFrappClient } from "./use-frapp-client";

const MEMBERS_ENDPOINT = "/v1/members";

vi.mock("./use-frapp-client", () => ({
  useFrappClient: vi.fn(),
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

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
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
});

describe("useMemberSearch", () => {
  let queryClient: QueryClient;
  const mockUseFrappClient = vi.mocked(useFrappClient);

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  it("executes search when query is provided", async () => {
    const members = [{ id: "member-1", chapter_id: "chapter-1" }];
    const mockGet = vi.fn().mockResolvedValue({ data: members, error: null });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberSearch("john"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/search", {
      params: { query: { q: "john" } },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(members);
  });

  it("does not fetch when query is empty", async () => {
    const mockGet = vi.fn();

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberSearch(""), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
