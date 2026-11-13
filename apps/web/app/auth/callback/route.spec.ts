import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
// The new-account check's chapters read (`GET /v1/chapters`). The check itself
// runs for real, so these specs drive it end to end.
const fetchMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({ captureException }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
  })),
}));



import { GET } from "./route";

const ORIGIN = "https://app.frapp.live";

async function callback(query: string) {
  const response = await GET(new Request(`${ORIGIN}/auth/callback?${query}`));
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return { status: response.status, url: new URL(location as string) };
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
    captureException.mockReset();
    fetchMock.mockReset();
    // Unexpected reads fail loudly in the assertions below, not silently.
    fetchMock.mockRejectedValue(new Error("unexpected chapters read"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the PKCE code and sends the member on to `next`, signed in", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { status, url } = await callback("code=abc123&next=%2Fjoin%3Ftoken%3Dinv-1");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(status).toBeGreaterThanOrEqual(300);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("token")).toBe("inv-1");
  });

  it("defaults `next` to the dashboard", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { url } = await callback("code=abc123");
    expect(url.pathname).toBe("/chat");
  });

  it("never redirects off-origin, however `next` is shaped", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    for (const next of ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "evil"]) {
      const { url } = await callback(`code=abc123&next=${encodeURIComponent(next)}`);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/chat");
    }
  });

  it("sends a failed exchange to sign-in with the destination and the reason", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });
    const { url } = await callback("code=stale&next=%2Fjoin%3Ftoken%3Dinv-1");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirectTo")).toBe("/join?token=inv-1");
    expect(url.searchParams.get("authError")).toBe("exchange_failed");
  });

  describe("the sign-up confirmation link (intent=confirm)", () => {
    it("signs the member in and sends them on to `next` when the code exchanges", async () => {
      exchangeCodeForSession.mockResolvedValue({ error: null });
      const { url } = await callback(
        "code=abc123&intent=confirm&next=%2Fjoin%3Ftoken%3Dinv-1",
      );
      expect(url.pathname).toBe("/join");
      expect(url.searchParams.get("token")).toBe("inv-1");
    });

    it("reads a code that won't exchange as a confirmed address, not a broken link", async () => {
      // GoTrue only hands out a code after it verified the link, so the
      // address is confirmed; what failed is the PKCE verifier, which lives in
      // the browser that signed up and is replaced by any later email flow.
      exchangeCodeForSession.mockResolvedValue({
        error: { name: "AuthPKCECodeVerifierMissingError", message: "verifier missing" },
      });
      const { url } = await callback(
        "code=abc123&intent=confirm&next=%2Fjoin%3Ftoken%3Dinv-1",
      );
      expect(url.pathname).toBe("/sign-in");
      expect(url.searchParams.get("redirectTo")).toBe("/join?token=inv-1");
      expect(url.searchParams.get("authError")).toBe("email_confirmed");
    });

    it("still reports a dead confirmation link as GoTrue's own error", async () => {
      const { url } = await callback(
        "error=access_denied&error_code=otp_expired&intent=confirm&next=%2Fchat",
      );
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
      expect(url.searchParams.get("authError")).toBe("otp_expired");
    });
  });

  it("passes GoTrue's own error code through without attempting an exchange", async () => {
    const { url } = await callback(
      "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=%2Fchat",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("otp_expired");
  });

  it("treats a link with no code as incomplete", async () => {
    const { url } = await callback("next=%2Fchat");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(url.searchParams.get("authError")).toBe("missing_code");
  });

  it("verifies a token_hash on this host and sends the member on to `next`", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { status, url } = await callback(
      "token_hash=pkce_hash&type=magiclink&next=%2Fjoin%3Ftoken%3Dinv-1",
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "pkce_hash",
      type: "magiclink",
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(status).toBeGreaterThanOrEqual(300);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("token")).toBe("inv-1");
  });

  it("refuses a crafted token_hash type before calling Auth", async () => {
    const { url } = await callback("token_hash=pkce_hash&type=not-a-type");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("verify_failed");
  });

  it("passes an OAuth identity collision through without exchanging a code", async () => {
    const { url } = await callback(
      "error=server_error&error_code=identity_already_exists&next=%2Fchat",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("identity_already_exists");
  });

  it("sends a failed hash verify to sign-in without attempting a PKCE exchange", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "otp_expired" } });
    const { url } = await callback("token_hash=stale&type=magiclink&next=%2Fchat");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("verify_failed");
  });

  describe("a sign-in that created a new account (#3786)", () => {
    const now = "2026-11-09T04:23:05.120Z";
    const freshGoogleUser = {
      email: "member@gmail.com",
      created_at: now,
      last_sign_in_at: "2026-11-09T04:23:05.410Z",
      app_metadata: { provider: "google" },
    };

    it("sends a brand-new Google account from the sign-in screen to the notice, keeping `next`", async () => {
      exchangeCodeForSession.mockResolvedValue({
        data: { user: freshGoogleUser },
        error: null,
      });
      const { url } = await callback("code=abc123&next=%2Fjoin%3Ftoken%3Dinv-1&intent=sign-in");
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/new-account");
      expect(url.searchParams.get("next")).toBe("/join?token=inv-1");
    });

    it("treats a brand-new Apple account the same way", async () => {
      exchangeCodeForSession.mockResolvedValue({
        data: { user: { ...freshGoogleUser, app_metadata: { provider: "apple" } } },
        error: null,
      });
      const { url } = await callback("code=abc123&intent=sign-in");
      expect(url.pathname).toBe("/new-account");
      expect(url.searchParams.get("next")).toBe("/chat");
    });

    it("sends a returning member straight on to `next`", async () => {
      exchangeCodeForSession.mockResolvedValue({
        data: {
          user: {
            ...freshGoogleUser,
            created_at: "2026-09-01T12:00:00Z",
            last_sign_in_at: now,
          },
        },
        error: null,
      });
      const { url } = await callback("code=abc123&next=%2Fevents&intent=sign-in");
      expect(url.pathname).toBe("/events");
    });

    it("does not stop a new account made from the sign-up screen", async () => {
      exchangeCodeForSession.mockResolvedValue({
        data: { user: freshGoogleUser },
        error: null,
      });
      const { url } = await callback("code=abc123&next=%2Fchat");
      expect(url.pathname).toBe("/chat");
    });

    it("never carries an off-origin `next` onto the notice", async () => {
      exchangeCodeForSession.mockResolvedValue({
        data: { user: freshGoogleUser },
        error: null,
      });
      const { url } = await callback(
        `code=abc123&intent=sign-in&next=${encodeURIComponent("//evil.example/x")}`,
      );
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/new-account");
      expect(url.searchParams.get("next")).toBe("/chat");
    });
  });

  describe("a magic link that created a new account (intent=sign-in-link, #3801)", () => {
    // As GoTrue hands it back on the sign-in that opened the account's first
    // link: created when the link was asked for, confirmed when it was opened.
    const newEmailUser = {
      email: "new@school.edu",
      identities: [{ provider: "email" }],
      app_metadata: { provider: "email" },
      created_at: "2026-11-13T09:00:00.000Z",
      email_confirmed_at: "2026-11-13T09:40:00.000Z",
      last_sign_in_at: "2026-11-13T09:40:00.300Z",
    };
    const session = { access_token: "member-token" };
    const chapters = (list: unknown[]) =>
      fetchMock.mockResolvedValue({ ok: true, json: async () => list });

    it("sends a brand-new, chapterless account from a token_hash link to the notice", async () => {
      verifyOtp.mockResolvedValue({ data: { user: newEmailUser, session }, error: null });
      chapters([]);
      const { url } = await callback(
        "token_hash=pkce_hash&type=magiclink&intent=sign-in-link&next=%2Fevents",
      );
      expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe(
        "Bearer member-token",
      );
      expect(url.pathname).toBe("/new-account");
      expect(url.searchParams.get("next")).toBe("/events");
    });

    it("sends a member who just joined a chapter on to `next`", async () => {
      verifyOtp.mockResolvedValue({ data: { user: newEmailUser, session }, error: null });
      chapters([{ chapter_id: "c1" }]);
      const { url } = await callback(
        "token_hash=pkce_hash&type=magiclink&intent=sign-in-link&next=%2Fevents",
      );
      expect(url.pathname).toBe("/events");
    });

    it("sends a returning chapterless account on to `next`, without reading the API", async () => {
      // Confirmed weeks ago, no chapter yet (waiting on an invite): not new.
      verifyOtp.mockResolvedValue({
        data: {
          user: {
            ...newEmailUser,
            created_at: "2026-10-01T12:00:00.000Z",
            email_confirmed_at: "2026-10-01T12:03:00.000Z",
          },
          session,
        },
        error: null,
      });
      const { url } = await callback(
        "token_hash=pkce_hash&type=magiclink&intent=sign-in-link&next=%2Fjoin%3Ftoken%3Dinv-1",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(url.pathname).toBe("/join");
    });

    it("signs the member in and sends them on when the chapters read fails", async () => {
      verifyOtp.mockResolvedValue({ data: { user: newEmailUser, session }, error: null });
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const { url } = await callback(
        "token_hash=pkce_hash&type=magiclink&intent=sign-in-link&next=%2Fchat",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(url.pathname).toBe("/chat");
    });

    it("catches a new account on the Confirm-signup code path too", async () => {
      exchangeCodeForSession.mockResolvedValue({ data: { user: newEmailUser, session }, error: null });
      chapters([]);
      const { url } = await callback("code=abc123&intent=sign-in-link&next=%2Fchat");
      expect(url.pathname).toBe("/new-account");
    });

    it("still reads a Confirm-signup code that won't exchange as a confirmed address", async () => {
      // The sign-in magic link keeps #3831's good-news handling: an email link
      // whose code GoTrue handed out was verified, so the address is confirmed.
      exchangeCodeForSession.mockResolvedValue({
        error: { name: "AuthPKCECodeVerifierMissingError", message: "verifier missing" },
      });
      const { url } = await callback("code=abc123&intent=sign-in-link&next=%2Fchat");
      expect(url.pathname).toBe("/sign-in");
      expect(url.searchParams.get("authError")).toBe("email_confirmed");
    });

    it("keeps a Google or Apple code that won't exchange a real failure", async () => {
      exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });
      const { url } = await callback("code=stale&intent=sign-in&next=%2Fchat");
      expect(url.searchParams.get("authError")).toBe("exchange_failed");
    });

    it.each([
      ["a code", () => exchangeCodeForSession, "code=abc123&intent=confirm&next=%2Fjoin%3Ftoken%3Dinv-1"],
      ["a token_hash", () => verifyOtp, "token_hash=h&type=email&intent=confirm&next=%2Fjoin%3Ftoken%3Dinv-1"],
    ])(
      "never stops a sign-up confirmation (%s) for a brand-new account, which is the point of sign-up",
      async (_path, auth, query) => {
        auth().mockResolvedValue({ data: { user: newEmailUser, session }, error: null });
        chapters([]);
        const { url } = await callback(query);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(url.pathname).toBe("/join");
      },
    );
  });

  describe("reporting what failed (#3832)", () => {
    type Captured = [Error, { level: string; fingerprint: string[]; tags: Record<string, string> }];
    const only = (): Captured => {
      expect(captureException).toHaveBeenCalledTimes(1);
      return captureException.mock.calls[0] as unknown as Captured;
    };
    const noLinkSecrets = ([error, context]: Captured) => {
      const payload = JSON.stringify({ message: error.message, stack: error.stack, context });
      for (const secret of ["pkce_secret", "code-secret", "inv-1", "token"]) {
        expect(payload, secret).not.toContain(secret);
      }
    };

    it("reports nothing when the link signs in", async () => {
      exchangeCodeForSession.mockResolvedValue({ error: null });
      await callback("code=abc123");
      expect(captureException).not.toHaveBeenCalled();
    });

    it("reports an Auth outage on a magic link at error, with GoTrue's status, not the member's verify_failed", async () => {
      verifyOtp.mockResolvedValue({
        error: Object.assign(new Error("upstream"), { name: "AuthApiError", status: 503, code: "unexpected_failure" }),
      });
      const { url } = await callback("token_hash=pkce_secret&type=magiclink&next=%2Fjoin%3Ftoken%3Dinv-1");
      expect(url.searchParams.get("authError")).toBe("verify_failed");
      const captured = only();
      expect(captured[1]).toMatchObject({
        level: "error",
        fingerprint: ["signed-out-auth", "auth_callback", "unexpected_failure"],
        tags: { auth_flow: "auth_callback", auth_screen: "/auth/callback", auth_failure_kind: "server", "http.status_code": "503" },
      });
      noLinkSecrets(captured);
    });

    it("counts a link opened in another browser by GoTrue's code, at info", async () => {
      exchangeCodeForSession.mockResolvedValue({
        error: Object.assign(new Error("code verifier"), { name: "AuthApiError", status: 400, code: "bad_code_verifier" }),
      });
      await callback("code=code-secret&intent=confirm");
      const captured = only();
      expect(captured[1]).toMatchObject({ level: "info", tags: { auth_error_code: "bad_code_verifier" } });
      noLinkSecrets(captured);
    });

    it("counts an expired link GoTrue sent back, once", async () => {
      await callback("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
      expect(only()[1]).toMatchObject({ level: "info", tags: { auth_error_code: "otp_expired" } });
    });

    it("reports a link whose type GoTrue never sends as a template fault", async () => {
      await callback("token_hash=pkce_secret&type=bogus");
      expect(only()[1]).toMatchObject({ level: "error", tags: { auth_error_code: "otp_type_invalid" } });
      expect(verifyOtp).not.toHaveBeenCalled();
    });
  });
});
