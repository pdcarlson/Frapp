import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * What the auth screens send to Sentry when a signed-out flow fails (#3832),
 * read at the SDK call: the level, the grouping and every tag, and that none
 * of it carries what the member typed. The rules themselves are tested in
 * `@repo/observability`'s `auth-failures.spec.ts`.
 */

const { replace, refresh, searchParams, toast, auth, captureException } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: { value: new URLSearchParams() },
  toast: vi.fn(),
  captureException: vi.fn(),
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    signInWithOAuth: vi.fn(),
    resend: vi.fn(),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
}));

vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => searchParams.value,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import SignUpPage from "@/app/(auth)/sign-up/page";
import { SignInScreen } from "./sign-in-screen";

const EMAIL = "new.member@example.com";
const PASSWORD = "correct-horse-battery";
const INVITE = "/join?token=inv-secret-1";

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submit(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

type Captured = [Error, { level: string; fingerprint: string[]; tags: Record<string, string> }];

function lastCapture(): Captured {
  const call = captureException.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call as unknown as Captured;
}

/** Nothing the member typed, and nothing from the URL, rides on the event. */
function expectNoMemberInput([error, context]: Captured) {
  const payload = JSON.stringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    context,
  });
  for (const secret of [EMAIL, PASSWORD, "inv-secret-1", "token=", "@"]) {
    expect(payload, secret).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams({ redirectTo: INVITE });
});

describe("signed-out auth failures reach Sentry", () => {
  it("counts an unconfirmed address on password sign-in at info, without the address", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(`Email not confirmed for ${EMAIL}`, 400, "email_not_confirmed"),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, PASSWORD);
    await submit(/^continue$/i);

    const captured = lastCapture();
    expect(captured[0].message).toBe("password_sign_in refused (email_not_confirmed)");
    expect(captured[1]).toEqual({
      level: "info",
      fingerprint: ["signed-out-auth", "password_sign_in", "email_not_confirmed"],
      tags: {
        auth_flow: "password_sign_in",
        auth_screen: "/sign-in",
        auth_failure_kind: "refusal",
        auth_expected: "true",
        auth_error_code: "email_not_confirmed",
        "http.status_code": "400",
      },
    });
    expectNoMemberInput(captured);
  });

  it("reports a GoTrue outage on the magic link at error", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("upstream connect error", 502, "unexpected_failure"),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    await submit(/magic link/i);

    const captured = lastCapture();
    expect(captured[1].level).toBe("error");
    expect(captured[1].tags).toMatchObject({
      auth_flow: "magic_link_send",
      auth_failure_kind: "server",
      auth_expected: "false",
    });
    expectNoMemberInput(captured);
  });

  it("reports a dead request on sign-up at error while the browser reads online", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, PASSWORD);
    await submit(/create account/i);

    const captured = lastCapture();
    expect(captured[1].level).toBe("error");
    expect(captured[1].fingerprint).toEqual(["signed-out-auth", "sign_up", "network"]);
    expectNoMemberInput(captured);
  });

  it("counts a taken address on sign-up, which GoTrue answers as a success", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "u1", identities: [] } },
      error: null,
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, PASSWORD);
    await submit(/create account/i);

    const captured = lastCapture();
    expect(captured[1].level).toBe("info");
    expect(captured[1].tags.auth_error_code).toBe("user_already_exists");
    expectNoMemberInput(captured);
  });

  it("leaves a failed link to /auth/callback, which reported it, so a reload or a typed authError counts nothing", () => {
    for (const authError of ["otp_expired", "made_up_value"]) {
      searchParams.value = new URLSearchParams({ redirectTo: INVITE, authError });
      render(<SignInScreen />);
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports Google failing to start on sign-in as oauth_start", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: null, provider: "google" },
      error: new AuthApiError("Unsupported provider: provider is not enabled", 400, "validation_failed"),
    });
    render(<SignInScreen />);
    await submit(/google/i);

    const captured = lastCapture();
    expect(captured[1].tags).toMatchObject({
      auth_flow: "oauth_start",
      auth_screen: "/sign-in",
      auth_error_code: "validation_failed",
    });
    expectNoMemberInput(captured);
  });

  it("reports a provider that is switched off on sign-up as an unexpected oauth_start", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: null, provider: "apple" },
      error: new AuthApiError("Provider is disabled", 400, "provider_disabled"),
    });
    render(<SignUpPage />);
    await submit(/apple/i);

    const captured = lastCapture();
    expect(captured[1]).toMatchObject({
      level: "error",
      fingerprint: ["signed-out-auth", "oauth_start", "provider_disabled"],
      tags: { auth_screen: "/sign-up" },
    });
  });

  it("reports a refused confirmation Resend, without the address", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
    });
    auth.resend.mockResolvedValue({
      data: {},
      error: new AuthApiError(`Email address "${EMAIL}" is invalid`, 400, "email_address_invalid"),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, PASSWORD);
    await submit(/^continue$/i);
    await submit(/^resend email$/i);

    const captured = lastCapture();
    expect(captured[1].tags).toMatchObject({
      auth_flow: "confirmation_resend",
      auth_error_code: "email_address_invalid",
    });
    expectNoMemberInput(captured);
  });

  it("reports nothing when sign-in succeeds", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: {}, user: { id: "u1" } },
      error: null,
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, PASSWORD);
    await submit(/^continue$/i);
    expect(captureException).not.toHaveBeenCalled();
  });
});
