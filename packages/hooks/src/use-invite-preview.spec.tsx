import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { useInvitePreview } from "./use-invites";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * #3352. The join screen's confirm card reads an invite before the member
 * joins with it. The token rides in the body, and a dead link (410) isn't
 * asked about again.
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

const PREVIEW = {
  chapter_name: "FIJI Tau Nu",
  university: "Rensselaer Polytechnic Institute",
  mark_text: "FIJI",
  accent_color: null,
  invited_by: "Paul Carlson",
  role: "Member",
  expires_at: "2026-11-05T20:00:00.000Z",
};

describe("useInvitePreview (#3352)", () => {
  it("asks nothing until there is an invite", () => {
    const POST = vi.fn();
    const { result } = renderHook(() => useInvitePreview(null), {
      wrapper: wrapperFor({ POST }),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(POST).not.toHaveBeenCalled();
  });

  it("sends the token in the body and returns the preview", async () => {
    const POST = vi.fn().mockResolvedValue({ data: PREVIEW, error: undefined });
    const { result } = renderHook(() => useInvitePreview("token-1"), {
      wrapper: wrapperFor({ POST }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(POST).toHaveBeenCalledWith("/v1/invites/preview", {
      body: { token: "token-1" },
    });
    expect(result.current.data).toEqual(PREVIEW);
  });

  it("doesn't retry a dead link", async () => {
    const POST = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 410, message: "Invite expired" },
    });
    const { result } = renderHook(() => useInvitePreview("token-2"), {
      wrapper: wrapperFor({ POST }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(POST).toHaveBeenCalledTimes(1);
  });
});
