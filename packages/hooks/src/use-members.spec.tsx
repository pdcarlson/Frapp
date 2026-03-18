import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMember, useMembers, useMemberSearch } from "./use-members";
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

describe("useMember", () => {
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

  it("returns a member when the API request succeeds", async () => {
    const id = "member-1";
    const member = { id, name: "Test User 1" };
    const mockGet = vi.fn().mockResolvedValue({ data: member, error: null });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMember(id), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/{id}", {
      params: { path: { id } },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(member);
  });

  it("surfaces API errors when the member request fails", async () => {
    const id = "member-1";
    const mockError = new Error("Failed to fetch member");
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMember(id), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/{id}", {
      params: { path: { id } },
    });
    expect(result.current.error).toBe(mockError);
  });

  it("is disabled and does not fetch when the id is empty", async () => {
    const id = "";
    const mockGet = vi.fn();

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMember(id), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.status).toBe("pending");
    expect(mockGet).not.toHaveBeenCalled();
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

  it("surfaces API errors when the members search request fails", async () => {
    const query = "test";
    const mockError = new Error("Failed to search members");
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });

    mockUseFrappClient.mockReturnValue({
      GET: mockGet,
    } as unknown as ReturnType<typeof useFrappClient>);

    const { result } = renderHook(() => useMemberSearch(query), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/members/search", {
      params: { query: { q: query } },
    });
    expect(result.current.error).toBe(mockError);
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
