import { describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { isSessionOver } from "./rejected-session";

const user = { id: "u1" };

describe("isSessionOver", () => {
  it("keeps a session Auth still recognises", () => {
    expect(isSessionOver({ data: { user }, error: null })).toBe(false);
  });

  it("ends a session whose user no longer exists", () => {
    const error = new AuthApiError(
      "User from sub claim in JWT does not exist",
      403,
      "user_not_found",
    );
    expect(isSessionOver({ data: { user: null }, error })).toBe(true);
  });

  it("ends a session Auth answers with no user", () => {
    expect(isSessionOver({ data: { user: null }, error: null })).toBe(true);
  });

  it("does not treat an Auth outage as a verdict", () => {
    expect(
      isSessionOver({
        data: { user: null },
        error: new AuthRetryableFetchError("fetch failed", 0),
      }),
    ).toBe(false);
    expect(
      isSessionOver({
        data: { user: null },
        error: new AuthApiError("down", 503, undefined),
      }),
    ).toBe(false);
    expect(
      isSessionOver({
        data: { user: null },
        error: new AuthApiError("slow down", 429, undefined),
      }),
    ).toBe(false);
  });
});

describe("isSessionOver, not a verdict", () => {
  it("does not treat an unreadable Auth answer or a missing local session as over", async () => {
    const { AuthUnknownError, AuthSessionMissingError } = await import(
      "@supabase/supabase-js"
    );
    expect(
      isSessionOver({
        data: { user: null },
        error: new AuthUnknownError("bad body", null),
      }),
    ).toBe(false);
    expect(
      isSessionOver({ data: { user: null }, error: new AuthSessionMissingError() }),
    ).toBe(false);
  });
});

describe("leaveWhenSignedOutElsewhere", () => {
  it("sends a dashboard tab to /sign-in and leaves signed-out routes alone", async () => {
    const { leaveWhenSignedOutElsewhere } = await import("./rejected-session");
    const assign = vi.fn();
    for (const [path, expected] of [
      ["/members", 1],
      ["/sign-in", 0],
      ["/join", 0],
      ["/no-access", 0],
      ["/new-account", 0],
    ] as const) {
      assign.mockClear();
      vi.stubGlobal("location", { pathname: path, assign });
      leaveWhenSignedOutElsewhere();
      expect(assign).toHaveBeenCalledTimes(expected);
    }
    vi.unstubAllGlobals();
  });
});
