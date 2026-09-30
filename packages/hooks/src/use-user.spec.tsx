import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  PHOTO_QUERY_FILTERS,
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

    const body = {
      filename: "me.png",
      content_type: "image/png",
      size_bytes: 9,
    };
    await expect(result.current.mutateAsync(body)).resolves.toEqual(ticket);
    expect(mockClient.POST).toHaveBeenCalledWith("/v1/users/me/avatar-url", {
      body,
    });
  });

  // Named literally rather than read back from `PHOTO_QUERY_FILTERS`, so
  // dropping one from that list fails here instead of passing with it.
  // `["user", "me"]` is exact so the permissions query under it isn't refetched.
  const EXPECTED_FILTERS = [
    { queryKey: ["user", "me"], exact: true },
    { queryKey: ["members"] },
    { queryKey: ["alumni"] },
    { queryKey: ["activity-feed"] },
  ];

  function photoMutationHarness() {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      DELETE: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    };
    // Each invalidation stays pending until released, so a test can see
    // whether `mutateAsync` waited for the refetches or resolved before them.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(() => gate);
    const invalidated = () => invalidate.mock.calls.map(([filters]) => filters);
    return {
      wrapper: createWrapper(queryClient, mockClient),
      invalidated,
      release: () => release(),
    };
  }

  async function expectWaitsForRefetch(
    mutate: () => Promise<unknown>,
    harness: ReturnType<typeof photoMutationHarness>,
  ) {
    let settled = false;
    const pending = mutate().then(() => {
      settled = true;
    });
    await waitFor(() =>
      expect(harness.invalidated()).toHaveLength(EXPECTED_FILTERS.length),
    );
    // Every refetch has started and none has finished: not resolved yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    harness.release();
    await pending;
    expect(settled).toBe(true);
    for (const filters of EXPECTED_FILTERS) {
      expect(harness.invalidated()).toContainEqual(filters);
    }
  }

  it("the filter list covers every read that serves the photo", () => {
    expect([...PHOTO_QUERY_FILTERS]).toEqual(EXPECTED_FILTERS);
  });

  it("confirm resolves only after every read that shows the photo refetched", async () => {
    const harness = photoMutationHarness();
    const { result } = renderHook(() => useConfirmAvatar(), {
      wrapper: harness.wrapper,
    });

    await expectWaitsForRefetch(
      () => result.current.mutateAsync("chapters/c/profiles/u/x.png"),
      harness,
    );
  });

  it("remove resolves only after every read that shows the photo refetched", async () => {
    const harness = photoMutationHarness();
    const { result } = renderHook(() => useRemoveAvatar(), {
      wrapper: harness.wrapper,
    });

    await expectWaitsForRefetch(() => result.current.mutateAsync(), harness);
  });

  it("confirm sends the path and surfaces an API refusal", async () => {
    const refusal = {
      message: "storage_path must be a photo in your own profile folder",
    };
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
