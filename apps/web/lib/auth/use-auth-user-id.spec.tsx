import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthCallback = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

const mockState = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  listeners: [] as AuthCallback[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockState.session } }),
      onAuthStateChange: (cb: AuthCallback) => {
        mockState.listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

const { useAuthUserId } = await import("./use-auth-user-id");

describe("useAuthUserId", () => {
  beforeEach(() => {
    mockState.session = null;
    mockState.listeners = [];
  });

  it("follows the Supabase auth uid across a same-tab account swap", async () => {
    mockState.session = { user: { id: "auth-user-1" } };
    const { result } = renderHook(() => useAuthUserId());

    await waitFor(() => expect(result.current).toBe("auth-user-1"));

    await act(async () => {
      for (const listener of mockState.listeners) {
        listener("SIGNED_IN", { user: { id: "auth-user-2" } });
      }
    });

    expect(result.current).toBe("auth-user-2");
  });
});
