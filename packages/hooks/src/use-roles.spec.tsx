import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useRoles } from "./use-roles";
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
      wrapper: createWrapper({ GET: mockGet }),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/roles");
    expect(result.current.error).toEqual(mockError);
  });
});
