import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  PROFILE_QUERY_FILTERS,
  useConfirmAvatar,
  useCurrentUser,
  useMyPermissions,
  useRemoveAvatar,
  useRequestAvatarUploadUrl,
  useUpdateUser,
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

describe("profile mutations (#732, #3387)", () => {
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

  // Named literally rather than read back from `PROFILE_QUERY_FILTERS`, so
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
      PATCH: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
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
      mockClient,
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

  it("the filter list covers every read that serves the profile", () => {
    expect([...PROFILE_QUERY_FILTERS]).toEqual(EXPECTED_FILTERS);
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

  // #3387. A name edit shows in the same reads the photo does: the
  // directory, and through the roster every chat author label; a city or
  // company edit in the directory and the alumni filters.
  it("a profile edit caches the saved row and refreshes every read without waiting", async () => {
    const harness = photoMutationHarness();
    // The server's row, not the cache with the body over it: a freshly
    // signed photo URL, and a city another device saved meanwhile.
    const saved = {
      id: "u-1",
      display_name: "Alex Rivera",
      current_city: "Albany, NY",
      avatar_url: "https://signed.example/new",
    };
    harness.mockClient.PATCH.mockResolvedValue({
      data: saved,
      error: undefined,
    });
    queryClient.setQueryData(["user", "me"], {
      id: "u-1",
      display_name: "Old Name",
      current_city: "Troy, NY",
    });
    const { result } = renderHook(() => useUpdateUser(), {
      wrapper: harness.wrapper,
    });

    // Settles while every refetch is still held: a refetch paused by a dropped
    // connection can't leave a save the server took stuck on "Saving…".
    await result.current.mutateAsync({ display_name: "Alex Rivera" });

    expect(harness.mockClient.PATCH).toHaveBeenCalledWith("/v1/users/me", {
      body: { display_name: "Alex Rivera" },
    });
    expect(queryClient.getQueryData(["user", "me"])).toEqual(saved);
    // Every read, the one just written too: that cancels a GET that left
    // before the PATCH landed and would otherwise answer last.
    for (const filters of EXPECTED_FILTERS) {
      expect(harness.invalidated()).toContainEqual(filters);
    }
    harness.release();
  });

  // A save still in flight across a sign-out or an account swap: the swap
  // cleared the cache, or the next member's row is in it now.
  it.each([
    ["the cache was cleared", undefined, { id: "u-1" }],
    ["another account's row is cached", { id: "u-2" }, { id: "u-1" }],
    // Neither side has an id: still not the same account.
    ["the cache was cleared and the row is null", undefined, null],
    ["neither row carries an id", { display_name: "Bea" }, { bio: "x" }],
  ])("doesn't cache the saved row when %s", async (_case, cachedRow, row) => {
    const harness = photoMutationHarness();
    harness.mockClient.PATCH.mockResolvedValue({
      data: row,
      error: undefined,
    });
    if (cachedRow) queryClient.setQueryData(["user", "me"], cachedRow);
    const { result } = renderHook(() => useUpdateUser(), {
      wrapper: harness.wrapper,
    });

    await result.current.mutateAsync({ display_name: "Alex Rivera" });

    expect(queryClient.getQueryData(["user", "me"])).toEqual(cachedRow);
    // Refetched instead, with whoever is signed in now.
    for (const filters of EXPECTED_FILTERS) {
      expect(harness.invalidated()).toContainEqual(filters);
    }
    harness.release();
  });

  it.each([null, undefined])(
    "leaves the cached profile alone when the PATCH answers %s",
    async (row) => {
      const harness = photoMutationHarness();
      harness.mockClient.PATCH.mockResolvedValue({
        data: row,
        error: undefined,
      });
      const cached = { id: "u-1", display_name: "Old Name" };
      queryClient.setQueryData(["user", "me"], cached);
      const { result } = renderHook(() => useUpdateUser(), {
        wrapper: harness.wrapper,
      });

      await result.current.mutateAsync({ display_name: "Alex Rivera" });

      expect(queryClient.getQueryData(["user", "me"])).toEqual(cached);
      harness.release();
    },
  );

  // A GET of the profile that left before the PATCH landed must not answer
  // last and put the pre-save row back. Real invalidation, no harness: the
  // save's refetch has to cancel the held GET.
  it("keeps the saved row over a profile GET that was already in flight", async () => {
    const before = { id: "u-1", display_name: "Old Name" };
    const saved = { id: "u-1", display_name: "Alex Rivera" };
    let answerHeldGet!: () => void;
    const GET = vi
      .fn()
      .mockResolvedValueOnce({ data: before, error: undefined })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerHeldGet = () => resolve({ data: before, error: undefined });
          }),
      )
      .mockResolvedValue({ data: saved, error: undefined });
    const mockClient = {
      GET,
      PATCH: vi.fn().mockResolvedValue({ data: saved, error: undefined }),
    };
    const { result } = renderHook(
      () => ({ me: useCurrentUser(), update: useUpdateUser() }),
      { wrapper: createWrapper(queryClient, mockClient) },
    );
    await waitFor(() => expect(result.current.me.data).toEqual(before));

    // A focus refetch leaves, and is held.
    void result.current.me.refetch();
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    await result.current.update.mutateAsync({ display_name: "Alex Rivera" });
    answerHeldGet();

    await waitFor(() => expect(GET).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(queryClient.getQueryData(["user", "me"])).toEqual(saved),
    );
    // Settled, and still the saved row.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryData(["user", "me"])).toEqual(saved);
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
