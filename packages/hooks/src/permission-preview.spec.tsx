import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import { PermissionPreviewProvider } from "./permission-preview";
import { useMyPermissions } from "./use-user";

/**
 * "View as a role" (#4072): a preview swaps what screens read, and leaves the
 * cached answer, which is the viewer's own, alone.
 */
function wrapper(queryClient: QueryClient, preview: readonly string[] | null) {
  const client = {
    GET: vi.fn().mockResolvedValue({
      data: { permissions: ["*"] },
      error: undefined,
    }),
  };
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="c1"
    >
      <QueryClientProvider client={queryClient}>
        <PermissionPreviewProvider permissions={preview}>
          {children}
        </PermissionPreviewProvider>
      </QueryClientProvider>
    </FrappClientProvider>
  );
  return Wrapper;
}

describe("useMyPermissions under a role preview", () => {
  it("reads the viewer's own set with no preview", async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: wrapper(queryClient, null),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.permissions).toEqual(["*"]);
  });

  it("reads the previewed set, and keeps the cache the viewer's", async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: wrapper(queryClient, ["members:view"]),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.permissions).toEqual(["members:view"]);
    expect(
      queryClient.getQueryData(["user", "me", "permissions", "c1"]),
    ).toEqual({ permissions: ["*"] });
  });
});
