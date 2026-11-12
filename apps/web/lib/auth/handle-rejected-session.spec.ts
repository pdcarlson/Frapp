/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * What `handleRejectedSession` reports when the API refused a session and Auth
 * is asked (#3832): Auth's own reason when it agrees the session is over,
 * nothing when it doesn't.
 */

const { getSession, getUser, signOut, reportAuthFailure, assign } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  reportAuthFailure: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession, getUser } }),
}));
vi.mock("@/lib/auth/session", () => ({ signOutCurrentSession: signOut }));
vi.mock("@/lib/sentry/auth-failures", () => ({ reportAuthFailure }));

const realLocation = window.location;

beforeEach(() => {
  vi.resetModules();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "t" } } });
  getUser.mockReset();
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

  it("reports nothing when Auth still accepts the session, or can't be asked", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await handle();
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    await handle();

    expect(reportAuthFailure).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
