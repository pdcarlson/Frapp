import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthApiError } from "@supabase/supabase-js";

const { resend, getSession, onAuthStateChange, authListener, unsubscribe } = vi.hoisted(() => {
  const authListener: { current: ((event: string, session: unknown) => void) | null } = {
    current: null,
  };
  const unsubscribe = vi.fn();
  return {
    resend: vi.fn(async () => ({ data: {}, error: null as unknown })),
    getSession: vi.fn(async () => ({ data: { session: null as unknown } })),
    onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
      authListener.current = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
    authListener,
    unsubscribe,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { resend, getSession, onAuthStateChange },
  }),
}));

import { CheckEmail, RESEND_COOLDOWN_SECONDS } from "./check-email";

const assign = vi.fn();

function renderPanel(initialCooldownSeconds = 0, onBack = vi.fn()) {
  render(
    <CheckEmail
      email="new.member@example.com"
      redirectTo="/join?token=inv-1"
      initialCooldownSeconds={initialCooldownSeconds}
      backLabel="Use a different email"
      onBack={onBack}
    />,
  );
  return { onBack };
}

describe("CheckEmail", () => {
  beforeEach(() => {
    resend.mockReset().mockResolvedValue({ data: {}, error: null });
    getSession.mockReset().mockResolvedValue({ data: { session: null } });
    onAuthStateChange.mockClear();
    unsubscribe.mockClear();
    authListener.current = null;
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign, origin: "https://app.frapp.live" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("names the address the link went to", () => {
    renderPanel();
    expect(screen.getByText("new.member@example.com")).toBeInTheDocument();
  });

  it("holds Resend for the minute GoTrue would refuse it, counting down", () => {
    vi.useFakeTimers();
    renderPanel(RESEND_COOLDOWN_SECONDS);
    const button = screen.getByRole("button", { name: /resend email in 60s/i });
    expect(button).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: /resend email in 59s/i })).toBeDisabled();
    for (let tick = 0; tick < 59; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByRole("button", { name: /^resend email$/i })).toBeEnabled();
  });

  it("resends the confirmation to the callback with intent=confirm and `next` kept", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend email$/i }));
    });
    expect(resend).toHaveBeenCalledTimes(1);
    const [args] = resend.mock.calls[0] as unknown as [
      { type: string; email: string; options: { emailRedirectTo: string } },
    ];
    expect(args.type).toBe("signup");
    expect(args.email).toBe("new.member@example.com");
    const link = new URL(args.options.emailRedirectTo);
    expect(link.pathname).toBe("/auth/callback");
    expect(link.searchParams.get("next")).toBe("/join?token=inv-1");
    expect(link.searchParams.get("intent")).toBe("confirm");
    expect(screen.getByRole("status")).toHaveTextContent(/sent a new link/i);
    expect(screen.getByRole("button", { name: /resend email in \d+s/i })).toBeDisabled();
  });

  it("reads a refused resend inside the minute as 'already sent', not as a failure", async () => {
    resend.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "For security purposes, you can only request this after 23 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend email$/i }));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/just sent you an email/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /resend email in 23s/i })).toBeDisabled();
  });

  it("never offers Resend while GoTrue says 'after 0 seconds'", async () => {
    resend.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "For security purposes, you can only request this after 0 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend email$/i }));
    });
    expect(screen.getByRole("button", { name: /resend email in 1s/i })).toBeDisabled();
  });

  it("carries on to `redirectTo` when the member comes back signed in", async () => {
    renderPanel();
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(assign).toHaveBeenCalledWith("/join?token=inv-1");
  });

  it("carries on when the tab becomes visible again signed in", async () => {
    renderPanel();
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(assign).toHaveBeenCalledWith("/join?token=inv-1");
  });

  it("doesn't read the session while the tab is hidden", async () => {
    renderPanel();
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(getSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops listening once it's gone, so the restored form isn't sent anywhere", async () => {
    const { unmount } = render(
      <CheckEmail
        email="new.member@example.com"
        redirectTo="/join?token=inv-1"
        initialCooldownSeconds={0}
        backLabel="Back"
        onBack={vi.fn()}
      />,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("says plainly when the hourly email cap refused the resend", async () => {
    resend.mockResolvedValue({
      data: {},
      error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
    });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend email$/i }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/can't send email right now/i);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /^resend email$/i })).toBeEnabled();
  });

  it("stays put when the member comes back still signed out", async () => {
    renderPanel();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getSession).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("carries on when the client reports a sign-in", () => {
    renderPanel();
    act(() => {
      authListener.current?.("SIGNED_IN", { access_token: "t" });
    });
    expect(assign).toHaveBeenCalledWith("/join?token=inv-1");
  });

  it("offers the way back", () => {
    const { onBack } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(onBack).toHaveBeenCalled();
  });
});
