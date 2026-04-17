import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useMyPermissions } from "./use-user";
import { FrappClientProvider } from "./use-frapp-client";

const createWrapper = (queryClient: QueryClient, mockClient: unknown) => {
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

describe("useMyPermissions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("returns the permission set when the request succeeds", async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: { permissions: ["members:view", "events:create"] },
        error: undefined,
      }),
    };

    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.GET).toHaveBeenCalledWith("/v1/users/me/permissions");
    expect(result.current.data).toEqual({
      permissions: ["members:view", "events:create"],
    });
  });

  it("surfaces errors from the SDK", async () => {
    const mockClient = {
      GET: vi
        .fn()
        .mockResolvedValue({ data: undefined, error: new Error("boom") }),
    };

    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("is disabled while `enabled: false`", async () => {
    const mockClient = { GET: vi.fn() };

    renderHook(() => useMyPermissions({ enabled: false }), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    // Give TanStack Query a tick to show that nothing was fetched.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockClient.GET).not.toHaveBeenCalled();
  });
});
