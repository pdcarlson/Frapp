import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  PHOTO_QUERY_KEYS,
  useConfirmAvatar,
  useMyPermissions,
  useRemoveAvatar,
  useRequestAvatarUploadUrl,
} from "./use-user";
import { FrappClientProvider } from "./use-frapp-client";

const createWrapper = (
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "test-chapter",
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

describe("profile photo mutations (#732)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("mints the upload URL with the body it was given", async () => {
    const ticket = { upload_url: "https://put", storage_path: "p" };
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: ticket, error: undefined }),
    };
    const { result } = renderHook(() => useRequestAvatarUploadUrl(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    const body = { filename: "me.png", content_type: "image/png", size_bytes: 9 };
    await expect(result.current.mutateAsync(body)).resolves.toEqual(ticket);
    expect(mockClient.POST).toHaveBeenCalledWith("/v1/users/me/avatar-url", {
      body,
    });
  });

  function photoMutationHarness() {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      DELETE: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    };
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const invalidatedKeys = () =>
      invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    return { wrapper: createWrapper(queryClient, mockClient), invalidatedKeys };
  }

  it("confirm refetches every read that shows the photo before resolving", async () => {
    const { wrapper, invalidatedKeys } = photoMutationHarness();
    const { result } = renderHook(() => useConfirmAvatar(), { wrapper });

    await result.current.mutateAsync("chapters/c/profiles/u/x.png");

    for (const key of PHOTO_QUERY_KEYS) expect(invalidatedKeys()).toContainEqual(key);
    // Keyed apart from `["members"]`, so it has to be named: a stale alumni
    // photo is what added it.
    expect(invalidatedKeys()).toContainEqual(["alumni"]);
  });

  it("remove refetches every read that shows the photo before resolving", async () => {
    const { wrapper, invalidatedKeys } = photoMutationHarness();
    const { result } = renderHook(() => useRemoveAvatar(), { wrapper });

    await result.current.mutateAsync();

    for (const key of PHOTO_QUERY_KEYS) expect(invalidatedKeys()).toContainEqual(key);
  });

  it("confirm sends the path and surfaces an API refusal", async () => {
    const refusal = { message: "storage_path must be a photo in your own profile folder" };
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: undefined, error: refusal }),
    };
    const { result } = renderHook(() => useConfirmAvatar(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await expect(result.current.mutateAsync("x")).rejects.toBe(refusal);
    expect(mockClient.POST).toHaveBeenCalledWith("/v1/users/me/avatar", {
      body: { storage_path: "x" },
    });
  });
});
