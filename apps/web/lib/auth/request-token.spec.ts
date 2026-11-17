import { describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { isRetryableFailure } from "@repo/api-sdk";
import { errorCopy } from "@repo/hooks/error-copy";
import { OFFLINE_COPY } from "@repo/validation";
import {
  readRequestToken,
  SIGN_IN_REFRESH_UNREACHABLE_MESSAGE,
} from "./request-token";

function clientAnswering(result: {
  data: { session: { access_token: string } | null };
  error: unknown;
}): Pick<SupabaseClient, "auth"> {
  return {
    auth: { getSession: vi.fn().mockResolvedValue(result) },
  } as unknown as Pick<SupabaseClient, "auth">;
}

describe("readRequestToken", () => {
  it("hands on the session's access token", async () => {
    const supabase = clientAnswering({
      data: { session: { access_token: "tok" } },
      error: null,
    });
    await expect(readRequestToken(supabase)).resolves.toBe("tok");
  });

  it("sends no token for a signed-out client", async () => {
    const supabase = clientAnswering({ data: { session: null }, error: null });
    await expect(readRequestToken(supabase)).resolves.toBeNull();
  });

  it("sends no token once Auth refused the refresh outright", async () => {
    const supabase = clientAnswering({
      data: { session: null },
      error: new AuthApiError(
        "Invalid Refresh Token: Refresh Token Not Found",
        400,
        "refresh_token_not_found",
      ),
    });
    await expect(readRequestToken(supabase)).resolves.toBeNull();
  });

  // FRAPP-API-E, 2026-11-17: a waking tab's refresh couldn't reach Auth, and
  // every dashboard read went out with no token and came back 401.
  it("holds the request back when the refresh could not reach Auth", async () => {
    const cause = new AuthRetryableFetchError("Failed to fetch", 0);
    const supabase = clientAnswering({ data: { session: null }, error: cause });

    const failure = await readRequestToken(supabase).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error).message).toBe(
      SIGN_IN_REFRESH_UNREACHABLE_MESSAGE,
    );
    expect((failure as Error).cause).toBe(cause);
    // Read downstream as the dropped connection it is: retried, and worded
    // as one rather than as a refusal.
    expect(isRetryableFailure(failure)).toBe(true);
    expect(errorCopy(failure)).toBe(OFFLINE_COPY);
  });
});
