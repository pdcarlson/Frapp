import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGetOrCreateDm } from "./use-chat";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: () => ({ POST: mockPost }),
}));

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useGetOrCreateDm channel-cache refresh (#316)", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  // The member directory's "Message" action calls mutateAsync then immediately
  // navigates to /chat?channel=<id>, where a fresh useChannels() observer
  // mounts and reads whatever is in the cache. That route has no mounted
  // ["channels"] observer at invalidation time (it's a different page), so
  // invalidateQueries' default `refetchType: "active"` would silently skip
  // the refetch and leave the pre-DM list in place until a later background
  // fetch caught up — the fresh chat page would flash the wrong channel.
  it("refetches the channel list even with no mounted observer, and mutateAsync waits for it", async () => {
    const qc = makeClient();
    let resolveChannelsRefetch!: (value: unknown) => void;
    const refetchChannels = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChannelsRefetch = resolve;
        }),
    );
    // Registers a queryFn for ["channels"] without mounting a useChannels()
    // observer, mirroring a stale-but-cached entry left over from an earlier
    // visit to /chat.
    qc.setQueryDefaults(["channels"], { queryFn: refetchChannels });
    qc.setQueryData(["channels"], [{ id: "general" }]);

    mockPost.mockResolvedValueOnce({ data: { id: "dm-1" }, error: undefined });

    const { result } = renderHook(() => useGetOrCreateDm(), {
      wrapper: makeWrapper(qc),
    });

    let settled = false;
    let mutatePromise!: Promise<unknown>;
    act(() => {
      mutatePromise = result.current
        .mutateAsync({ member_id: "u2" })
        .then((value) => {
          settled = true;
          return value;
        });
    });

    // Flush microtasks: mutateAsync must not settle yet, since it awaits the
    // channels refetch this mutation's onSuccess triggers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refetchChannels).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await act(async () => {
      resolveChannelsRefetch([{ id: "general" }, { id: "dm-1" }]);
      await mutatePromise;
    });

    expect(settled).toBe(true);
    expect(qc.getQueryData(["channels"])).toEqual([
      { id: "general" },
      { id: "dm-1" },
    ]);
  });
});
