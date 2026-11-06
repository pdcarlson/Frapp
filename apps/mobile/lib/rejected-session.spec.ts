import { describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { createRejectedSessionHandler, isSessionOver } from "./rejected-session";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

function fakeSupabase(result: { data: { user: unknown }; error: unknown }) {
  return { auth: { getUser: vi.fn(async () => result) } } as never;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("isSessionOver", () => {
  it("ends a session whose user no longer exists", () => {
    const error = new AuthApiError("gone", 403, "user_not_found");
    expect(isSessionOver({ data: { user: null }, error })).toBe(true);
  });

  it("keeps a live session and ignores an outage", () => {
    expect(isSessionOver({ data: { user: { id: "u" } }, error: null })).toBe(false);
    expect(
      isSessionOver({
        data: { user: null },
        error: new AuthRetryableFetchError("fetch failed", 0),
      }),
    ).toBe(false);
  });
});

describe("createRejectedSessionHandler", () => {
  it("signs out once for a burst of 401s when Auth agrees", async () => {
    const supabase = fakeSupabase({
      data: { user: null },
      error: new AuthApiError("gone", 403, "user_not_found"),
    });
    const signOut = vi.fn(async () => {});
    const notify = vi.fn();
    const handle = createRejectedSessionHandler({
      getSupabase: () => supabase,
      signOut,
      notify,
    });

    handle();
    handle();
    handle();
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves a session Auth still recognises", async () => {
    const signOut = vi.fn(async () => {});
    const handle = createRejectedSessionHandler({
      getSupabase: () => fakeSupabase({ data: { user: { id: "u" } }, error: null }),
      signOut,
      notify: vi.fn(),
    });

    handle();
    await flush();

    expect(signOut).not.toHaveBeenCalled();
  });
});
