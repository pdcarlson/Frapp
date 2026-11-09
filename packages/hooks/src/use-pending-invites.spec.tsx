import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { usePendingInvites } from "./use-invites";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * #3776. The join screen offers the invites emailed to the account's verified
 * address. The client sends no address: the API reads it from the account.
 */

function wrapperFor(client: unknown) {
  const queryClient = new QueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as ReturnType<typeof import("@repo/api-sdk").createFrappClient>
      }
      chapterId={null}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

const PENDING = [
  {
    chapter_name: "Sigma Chi Alpha",
    university: "State",
    mark_text: null,
    accent_color: null,
    invited_by: "Paul Carlson",
    role: "Member",
    expires_at: "2026-11-10T20:00:00.000Z",
    token: "token-1",
  },
];

describe("usePendingInvites (#3776)", () => {
  it("asks nothing until the session is known", () => {
    const GET = vi.fn();
    const { result } = renderHook(() => usePendingInvites(null), {
      wrapper: wrapperFor({ GET }),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(GET).not.toHaveBeenCalled();
  });

  it("reads the caller's own list, naming no address", async () => {
    const GET = vi.fn().mockResolvedValue({ data: PENDING, error: undefined });
    const { result } = renderHook(() => usePendingInvites("user-1"), {
      wrapper: wrapperFor({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/invites/mine");
    expect(result.current.data).toEqual(PENDING);
  });

  it("surfaces a failure without retrying", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { statusCode: 500 } });
    const { result } = renderHook(() => usePendingInvites("user-1"), {
      wrapper: wrapperFor({ GET }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(GET).toHaveBeenCalledTimes(1);
  });
});
