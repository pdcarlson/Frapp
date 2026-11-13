import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";

/**
 * The launch-day path (2026-11-09), screen by screen: an invited member
 * creates a password account on a hosted project, which requires email
 * confirmation (#3776), so no session comes back. Before this, the sign-up
 * screen toasted and bounced to the sign-in form, where every attempt read
 * "Something went wrong" and the magic link hit GoTrue's email cooldown.
 */

const { replace, refresh, searchParams, toast, auth } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: { value: new URLSearchParams() },
  toast: vi.fn(),
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    resend: vi.fn(async () => ({ data: {}, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
}));

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
import {
  EMAIL_SEND_CAPPED_COPY,
  WRONG_CREDENTIALS_COPY,
} from "@repo/hooks/auth-error-copy";

const EMAIL = "new.member@example.com";
const INVITE = "/join?token=inv-1";

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submit(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams({ redirectTo: INVITE });
});

describe("sign-up on a project that confirms email", () => {
  beforeEach(() => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "u1", identities: [{ id: "i1" }] } },
      error: null,
    });
  });

  it("stays on the screen as 'Check your email' instead of bouncing to sign-in", async () => {
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Check your email");
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("asks for the confirmation link to come back with intent=confirm and the invite", async () => {
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);

    const [args] = auth.signUp.mock.calls[0] as unknown as [
      { options: { emailRedirectTo: string } },
    ];
    const link = new URL(args.options.emailRedirectTo);
    expect(link.pathname).toBe("/auth/callback");
    expect(link.searchParams.get("next")).toBe(INVITE);
    expect(link.searchParams.get("intent")).toBe("confirm");
  });

  it("holds Resend for the minute after the first email", async () => {
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);
    expect(screen.getByRole("button", { name: /resend email in 60s/i })).toBeDisabled();
  });

  it("keeps the invite on the way to sign-in from another device", async () => {
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);
    const link = screen.getByRole("link", { name: /sign in here/i });
    expect(link.getAttribute("href")).toBe(`/sign-in?redirectTo=${encodeURIComponent(INVITE)}`);
  });

  it("goes back to 'Check your email' when the same address is resubmitted inside the minute", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(
        "For security purposes, you can only request this after 37 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Check your email");
    expect(screen.getByRole("button", { name: /resend email in 37s/i })).toBeDisabled();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("holds Resend for at least a second when GoTrue says 'after 0 seconds'", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(
        "For security purposes, you can only request this after 0 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);
    expect(screen.getByRole("button", { name: /resend email in 1s/i })).toBeDisabled();
  });

  it("names a breached password through the page, not GoTrue's sentence", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthWeakPasswordError("Password is known to be weak and easy to guess", 422, [
        "pwned",
      ]),
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "password123");
    await submit(/create account/i);

    const call = toast.mock.calls.at(-1)?.[0] as { title: string; description: string };
    expect(call.title).toBe("Unable to create account");
    expect(call.description).toMatch(/data breach/);
    expect(call.description).not.toMatch(/known to be weak/);
  });

  it("tells an address that already has an account to sign in, not to wait for email", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "u1", identities: [] } },
      error: null,
    });
    render(<SignUpPage />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/create account/i);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "You already have an account" }),
    );
  });
});

describe("password sign-in before the email is confirmed", () => {
  beforeEach(() => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
    });
  });

  it("swaps the form for 'Confirm your email' with that address and Resend", async () => {
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/^continue$/i);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Confirm your email");
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resend email$/i })).toBeEnabled();
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: "Something went wrong. Please try again." }),
    );
  });

  it("goes back to the form on request", async () => {
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, "correct horse");
    await submit(/^continue$/i);
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back");
  });
});

describe("other sign-in refusals", () => {
  it("says a wrong password doesn't match", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    fill(/password/i, "wrong");
    await submit(/^continue$/i);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unable to sign in",
        description: WRONG_CREDENTIALS_COPY,
        variant: "destructive",
      }),
    );
  });

  it("reads a magic link asked for inside the email minute as 'check your inbox'", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(
        "For security purposes, you can only request this after 44 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    await submit(/magic link/i);
    const call = toast.mock.calls.at(-1)?.[0] as { title: string; description: string; variant?: string };
    expect(call.title).toBe("Check your inbox");
    expect(call.description).toContain("44 seconds");
    expect(call.variant).toBeUndefined();
  });

  it("asks for the magic link with intent=sign-in-link, so a new account is caught and a confirmation stays good news (#3801)", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    await submit(/magic link/i);
    const [args] = auth.signInWithOtp.mock.calls[0] as unknown as [
      { options: { emailRedirectTo: string } },
    ];
    const link = new URL(args.options.emailRedirectTo);
    expect(link.searchParams.get("next")).toBe(INVITE);
    expect(link.searchParams.get("intent")).toBe("sign-in-link");
  });

  it("reports the hourly email cap as a failure that sent nothing", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
    });
    render(<SignInScreen />);
    fill(/email/i, EMAIL);
    await submit(/magic link/i);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unable to send magic link",
        description: EMAIL_SEND_CAPPED_COPY,
        variant: "destructive",
      }),
    );
  });

  it("greets a confirmation link that couldn't sign this browser in as good news", () => {
    searchParams.value = new URLSearchParams({
      redirectTo: INVITE,
      authError: "email_confirmed",
    });
    render(<SignInScreen />);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Email confirmed" }),
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
