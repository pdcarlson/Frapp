import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useRoles, useCreateRole } from "./use-roles";
import { FrappClientProvider } from "./use-frapp-client";

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

  const createWrapper = (mockClient: unknown) => {
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
  };

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
      wrapper: createWrapper({ GET: mockGet }),
    });

    await waitFor(async () => {
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
      wrapper: createWrapper({ GET: mockGet }),
    });

    await waitFor(async () => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/roles");
    expect(result.current.error).toEqual(mockError);
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

  const createWrapper = (mockClient: unknown) => {
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
  };

  it("creates a role and invalidates queries on success", async () => {
    const mockRole = { id: "role-3", name: "Secretary", permissions: ["members.read"] };
    const mockPost = vi.fn().mockResolvedValue({
      data: mockRole,
      error: null,
    });

    const { result } = renderHook(() => useCreateRole(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    const payload = {
      name: "Secretary",
      permissions: ["members.read"],
      display_order: 1,
      color: "#000000",
    };

    await waitFor(async () => {
      await expect(result.current.mutateAsync(payload)).resolves.toEqual(mockRole);
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["roles"],
    });
  });

  it("surfaces an error when request fails", async () => {
    const mockError = new Error("Failed to create role");
    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const { result } = renderHook(() => useCreateRole(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    const payload = {
      name: "Secretary",
      permissions: ["members.read"],
    };

    await waitFor(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow(mockError);
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/roles", { body: payload });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
