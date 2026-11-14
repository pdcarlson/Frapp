import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import { useDismissOpsNudge } from "./use-members";

const CHAPTER_ID = "chapter-abc";
const DISMISS_PATH = "/v1/members/me/ops-nudges/dismiss";

function makeWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={mockClient as unknown as ReturnType<typeof createFrappClient>}
      chapterId={CHAPTER_ID}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "OpsNudgeWrapper";
  return Wrapper;
}

/**
 * The dismiss mutation's `scope` is the *only* thing preventing a lost update
 * (#492).
 *
 * The server appends to `members.dismissed_ops_nudges` read-modify-write, and
 * dismissing one nudge falls the next one through immediately — a fresh dismiss
 * control lands under the cursor in the same spot, so two writes really can
 * overlap. Two writes that both read the pre-write array end with the later one
 * erasing the earlier key, and the symptom is invisible in CI and easy to
 * dismiss in the field as ordinary optimistic-UI drift: one already-dismissed
 * card quietly reappearing next session.
 *
 * This is pinned here rather than in the component test because the component
 * mocks `useDismissOpsNudge` wholesale — no real mutation cache, so nothing
 * there can observe serialization. An earlier revision guarded the race by
 * disabling the control while `isPending`, and that guard *was* tested; when it
 * was replaced with `scope` (a disabled control greys out the successor card for
 * the whole retry window, and indefinitely offline — a dead-end control), the
 * coverage did not move with it. Deleting the one-line option would otherwise
 * leave every test in the repo green.
 */
describe("useDismissOpsNudge serialization", () => {
  it("does not start the second dismissal until the first has resolved", async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];

    const PATCH = vi.fn((path: string, init: { body: { module_key: string } }) => {
      started.push(init.body.module_key);
      if (path === DISMISS_PATH && started.length === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ data: {}, error: undefined });
        });
      }
      return Promise.resolve({ data: {}, error: undefined });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useDismissOpsNudge(), {
      wrapper: makeWrapper(queryClient, { PATCH }),
    });

    // Fire both without awaiting either — the overlap the real flow produces.
    act(() => {
      result.current.mutate({ module_key: "dues" });
      result.current.mutate({ module_key: "events" });
    });

    // The load-bearing assertion. Without a shared `scope` both requests are in
    // flight here and both read the same pre-write array on the server.
    await waitFor(() => expect(started).toEqual(["dues"]));
    expect(PATCH).toHaveBeenCalledTimes(1);

    act(() => releaseFirst?.());

    // Only now may the second run — so its read sees the first write.
    await waitFor(() => expect(started).toEqual(["dues", "events"]));
  });

  it("sends the module key to the dismiss route", async () => {
    const PATCH = vi
      .fn()
      .mockResolvedValue({ data: {}, error: undefined });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useDismissOpsNudge(), {
      wrapper: makeWrapper(queryClient, { PATCH }),
    });

    await act(async () => {
      await result.current.mutateAsync({ module_key: "points" });
    });

    expect(PATCH).toHaveBeenCalledWith(DISMISS_PATH, {
      body: { module_key: "points" },
    });
  });
});
