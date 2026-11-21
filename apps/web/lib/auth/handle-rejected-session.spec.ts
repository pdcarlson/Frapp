/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

/**
 * What `handleRejectedSession` reports when the API refused a session and Auth
 * is asked (#3832): Auth's own reason when it agrees the session is over,
 * nothing when it doesn't.
 */

const { getSession, getUser, signOut, signingOutHere, reportAuthFailure, assign } = vi.hoisted(() => ({
  signingOutHere: vi.fn(() => false),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  reportAuthFailure: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession, getUser } }),
}));
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: signOut,
  signingOutHere,
}));
vi.mock("@/lib/sentry/auth-failures", () => ({ reportAuthFailure }));

const realLocation = window.location;

beforeEach(() => {
  vi.resetModules();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "t" } } });
  getUser.mockReset();
  signingOutHere.mockReset().mockReturnValue(false);
  signOut.mockReset().mockResolvedValue(undefined);
  reportAuthFailure.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, origin: "https://app.frapp.live", pathname: "/chat", assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

async function handle() {
  // A fresh module per test: the handler latches once it is leaving.
  const { handleRejectedSession } = await import("./rejected-session");
  await handleRejectedSession();
}

describe("handleRejectedSession reporting", () => {
  it("reports Auth's reason before signing out", async () => {
    const gone = new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found");
    getUser.mockResolvedValue({ data: { user: null }, error: gone });
    await handle();

    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "session_check",
      screen: "/chat",
      error: gone,
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("ends a session revoked elsewhere, which Auth answers as no session (#4440)", async () => {
    // GoTrue's `session_not_found` reaches us as `AuthSessionMissingError`
    // (reproduced on the local stack with a global sign-out from another client).
    const missing = new AuthSessionMissingError();
    getUser.mockResolvedValue({ data: { user: null }, error: missing });
    await handle();

    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "session_check",
      screen: "/chat",
      error: missing,
      code: "session_not_found",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledWith(
      "https://app.frapp.live/sign-in?signedOut=session_ended",
    );
  });

  it("doesn't read the tab's own sign-out as a revoke", async () => {
    // A global sign-out revokes on the server before it drops the local
    // session, so a 401 in between gets the revoked answer too.
    signingOutHere.mockReturnValue(true);
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    await handle();

    expect(reportAuthFailure).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks Auth nothing for a 401 that lands after the local session is gone", async () => {
    // Past that check, "no session" reads as a revoke (`sessionVerdict`).
    getSession.mockResolvedValue({ data: { session: null } });
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    await handle();

    expect(getUser).not.toHaveBeenCalled();
    expect(reportAuthFailure).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("reports nothing when Auth still accepts the session, or can't be asked", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await handle();
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    await handle();

    expect(reportAuthFailure).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
