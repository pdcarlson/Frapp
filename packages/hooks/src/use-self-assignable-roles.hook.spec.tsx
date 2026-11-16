/**
 * `useSetPickedRole` itself (#4958 review): the route each answer takes, the
 * viewer's roles written from the answer so a switch never shows its old
 * state, and the reads that follow, the channel list among them.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useSetPickedRole } from "./use-self-assignable-roles";

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
  useActiveChapterId: vi.fn(),
}));

describe("useSetPickedRole (#4958)", () => {
  let queryClient: QueryClient;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    post = vi.fn(async () => ({
      data: { role_ids: ["r-member", "r-im"] },
      error: undefined,
    }));
    vi.mocked(useFrappClient).mockReturnValue({
      POST: post,
    } as unknown as ReturnType<typeof useFrappClient>);
    vi.mocked(useActiveChapterId).mockReturnValue("ch-1");
    queryClient.setQueryData(
      ["chapters", "accessible"],
      [
        { chapter_id: "ch-1", role_ids: ["r-member"] },
        { chapter_id: "ch-2", role_ids: ["r-other"] },
      ],
    );
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("joins through /join and leaves through /leave", async () => {
    const { result } = renderHook(() => useSetPickedRole(), { wrapper });
    await act(() => result.current.mutateAsync({ id: "r-im", join: true }));
    await act(() => result.current.mutateAsync({ id: "r-im", join: false }));
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      "/v1/roles/{id}/join",
      "/v1/roles/{id}/leave",
    ]);
    expect(post.mock.calls[0]![1]).toEqual({
      params: { path: { id: "r-im" } },
    });
  });

  it("writes the answer's roles into the active membership before it resolves", async () => {
    const { result } = renderHook(() => useSetPickedRole(), { wrapper });
    await act(() => result.current.mutateAsync({ id: "r-im", join: true }));
    expect(queryClient.getQueryData(["chapters", "accessible"])).toEqual([
      { chapter_id: "ch-1", role_ids: ["r-member", "r-im"] },
      { chapter_id: "ch-2", role_ids: ["r-other"] },
    ]);
  });

  it("reads the roles, permissions, roster and channel list again", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetPickedRole(), { wrapper });
    await act(() => result.current.mutateAsync({ id: "r-im", join: true }));
    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ["chapters"],
      ["user", "me"],
      ["members", "ch-1"],
      ["channels"],
    ]);
  });
});
