import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { createRejectedSessionHandler, isSessionOver } from "./rejected-session";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

const reportAuthFailure = vi.hoisted(() => vi.fn());
vi.mock("./sentry/auth-failures", () => ({ reportAuthFailure }));

function fakeSupabase(result: { data: { user: unknown }; error: unknown }) {
  let session: unknown = { access_token: "t" };
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      getUser: vi.fn(async () => result),
    },
    signOutLocally: () => {
      session = null;
    },
  };
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
  beforeEach(() => reportAuthFailure.mockClear());

  it("signs out once for a burst of 401s when Auth agrees", async () => {
    const supabase = fakeSupabase({
      data: { user: null },
      error: new AuthApiError("gone", 403, "user_not_found"),
    });
    const signOut = vi.fn(async () => {});
    const notify = vi.fn();
    const handle = createRejectedSessionHandler({
      getSupabase: () => supabase as never,
      signOut,
      notify,
    });

    handle();
    handle();
    handle();
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    // Auth's reason is counted once, with the error it answered (#3832).
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({
      flow: "session_check",
      error: { code: "user_not_found" },
    });
  });

  it("ends a session revoked elsewhere, which Auth answers as no session (#4440)", async () => {
    const supabase = fakeSupabase({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    const signOut = vi.fn(async () => {});
    const notify = vi.fn();
    const handle = createRejectedSessionHandler({
      getSupabase: () => supabase as never,
      signOut,
      notify,
    });

    handle();
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({
      flow: "session_check",
      code: "session_not_found",
    });
  });

  it("asks Auth nothing once the local session is gone", async () => {
    const supabase = fakeSupabase({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    supabase.signOutLocally();
    const signOut = vi.fn(async () => {});
    const handle = createRejectedSessionHandler({
      getSupabase: () => supabase as never,
      signOut,
      notify: vi.fn(),
    });

    handle();
    await flush();

    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(reportAuthFailure).not.toHaveBeenCalled();
  });

  it("leaves a session Auth still recognises", async () => {
    const signOut = vi.fn(async () => {});
    const handle = createRejectedSessionHandler({
      getSupabase: () => fakeSupabase({ data: { user: { id: "u" } }, error: null }) as never,
      signOut,
      notify: vi.fn(),
    });

    handle();
    await flush();

    expect(signOut).not.toHaveBeenCalled();
    expect(reportAuthFailure).not.toHaveBeenCalled();
  });
});

describe("createRejectedSessionHandler after sign-out", () => {
  it("does not sign out again for a 401 that lands after the session is gone", async () => {
    const supabase = fakeSupabase({
      data: { user: null },
      error: new AuthApiError("gone", 403, "user_not_found"),
    });
    const signOut = vi.fn(async () => {
      supabase.signOutLocally();
    });
    const notify = vi.fn();
    const handle = createRejectedSessionHandler({
      getSupabase: () => supabase as never,
      signOut,
      notify,
    });

    handle();
    await flush();
    handle();
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
