import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

/**
 * #3776. `/join` asks Auth whether the visitor is signed in. A cookie Auth no
 * longer accepts must be cleared on the way to sign-in, or the proxy (which
 * trusts the cookie) sends the visitor straight back and the page loops.
 */

const { getUser, signOut, reportAuthFailure } = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  reportAuthFailure: vi.fn(),
}));

vi.mock("@/lib/sentry/auth-failures", () => ({ reportAuthFailure }));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: signOut,
}));

import { getLiveSessionUser } from "./rejected-session";

describe("getLiveSessionUser (#3776)", () => {
  beforeEach(() => {
    getUser.mockReset();
    signOut.mockReset();
    reportAuthFailure.mockReset();
    signOut.mockResolvedValue(undefined);
  });

  it("returns the user Auth recognises, clearing nothing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(getLiveSessionUser()).resolves.toEqual({ id: "u1" });
    expect(signOut).not.toHaveBeenCalled();
    expect(reportAuthFailure).not.toHaveBeenCalled();
  });

  it("is null for a visitor with no session, with nothing to clear", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    await expect(getLiveSessionUser()).resolves.toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    // A visitor who was never signed in is not a failure.
    expect(reportAuthFailure).not.toHaveBeenCalled();
  });

  it("clears a session Auth refuses before reporting signed out", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "User from sub claim in JWT does not exist",
        403,
        "user_not_found",
      ),
    });
    await expect(getLiveSessionUser()).resolves.toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({
      flow: "session_check",
      screen: "/join",
      error: { code: "user_not_found" },
    });
  });

  it("throws on an Auth outage instead of signing anyone out", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    await expect(getLiveSessionUser()).rejects.toBeInstanceOf(
      AuthRetryableFetchError,
    );
    expect(signOut).not.toHaveBeenCalled();
    // Auth unreachable is reported (as `network` by the reporter's rules).
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({ flow: "session_check" });
  });
});
