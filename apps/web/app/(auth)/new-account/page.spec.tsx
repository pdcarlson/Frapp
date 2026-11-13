import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getUser, getSession, redirect, signOutCurrentSession, isNewEmailAccount } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })),
    redirect: vi.fn((to: string) => {
      throw new Error(`NEXT_REDIRECT ${to}`);
    }),
    signOutCurrentSession: vi.fn(async () => {}),
    isNewEmailAccount: vi.fn(async () => false),
  }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser, getSession } })),
}));
vi.mock("@/lib/auth/session", () => ({ signOutCurrentSession }));
vi.mock("@/lib/auth/new-account-detection", () => ({ isNewEmailAccount }));

import NewAccountPage from "./page";
import { NEW_ACCOUNT_SIGN_OUT_FAILED } from "@/components/auth/new-account-actions";

function freshUser(email: string) {
  return {
    email,
    created_at: "2026-11-09T04:23:05.120Z",
    last_sign_in_at: "2026-11-09T04:23:05.410Z",
    app_metadata: { provider: "google" },
  };
}

async function renderPage(next?: string) {
  const ui = await NewAccountPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  });
  return render(ui);
}

describe("/new-account (#3786)", () => {
  const assign = vi.fn();

  beforeEach(() => {
    getUser.mockReset();
    getSession.mockClear();
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    isNewEmailAccount.mockReset();
    isNewEmailAccount.mockResolvedValue(false);
    redirect.mockClear();
    signOutCurrentSession.mockClear();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  function emailUser(email: string) {
    return {
      email,
      // A magic-link account is created when the link is requested, so its
      // timestamps are far apart; the OAuth check never flags it.
      created_at: "2026-11-09T04:00:00.000Z",
      last_sign_in_at: "2026-11-09T05:30:00.000Z",
      app_metadata: { provider: "email" },
      identities: [{ provider: "email" }],
    };
  }

  it("shows a brand-new magic-link account the notice (#3801)", async () => {
    getUser.mockResolvedValue({ data: { user: emailUser("new@school.edu") } });
    isNewEmailAccount.mockResolvedValue(true);
    await renderPage("/chat");
    expect(redirect).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "This is a new Frapp account for new@school.edu. Already a member? Sign out and use the method you joined with.",
      ),
    ).toBeTruthy();
  });

  it("sends an existing email member who belongs to a chapter straight on (#3801)", async () => {
    getUser.mockResolvedValue({ data: { user: emailUser("member@school.edu") } });
    isNewEmailAccount.mockResolvedValue(false);
    await expect(renderPage("/events")).rejects.toThrow("NEXT_REDIRECT");
    expect(isNewEmailAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@school.edu" }),
      "tok",
    );
    expect(redirect).toHaveBeenCalledWith("/events");
  });

  it("names the new account and tells a member how to get back to theirs", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("member@gmail.com") } });
    await renderPage("/chat");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText(
        "This is a new Frapp account for member@gmail.com. Already a member? Sign out and use the method you joined with.",
      ),
    ).toBeTruthy();
  });

  it("signs out in one step and returns to sign-in with the destination kept", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("member@gmail.com") } });
    await renderPage("/join?token=inv-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    // Local scope: the browser's session is gone even if Auth's revoke fails,
    // so the proxy can't bounce `/sign-in` back into the new account.
    expect(signOutCurrentSession).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledWith("/sign-in?redirectTo=%2Fjoin%3Ftoken%3Dinv-1");
  });

  it("lets a new member carry on to where they were going", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("new@gmail.com") } });
    await renderPage("/join?token=inv-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Continue with the new account" }),
    );
    expect(signOutCurrentSession).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/join?token=inv-1");
  });

  it("guards `next` against leaving the origin", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("new@gmail.com") } });
    await renderPage("//evil.example/x");
    await userEvent.click(
      screen.getByRole("button", { name: "Continue with the new account" }),
    );
    expect(assign).toHaveBeenCalledWith("/chat");
  });

  it("sends a visitor with no session to sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(renderPage("/events")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/sign-in?redirectTo=%2Fevents");
  });

  it("sends an account that isn't new straight on to `next`", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          ...freshUser("member@icloud.com"),
          created_at: "2026-09-01T12:00:00Z",
          app_metadata: { provider: "apple" },
        },
      },
    });
    await expect(renderPage("/events")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/events");
  });

  it("leads with Sign out when there's no invite", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("member@gmail.com") } });
    await renderPage("/chat");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Sign out",
      "Continue with the new account",
    ]);
  });

  it("leads with Continue when `next` is an invite, since invite links land on sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("new@gmail.com") } });
    await renderPage("/join?token=inv-1");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Continue with the new account",
      "Sign out",
    ]);
  });

  it("says so, and stays put, when the sign-out throws", async () => {
    getUser.mockResolvedValue({ data: { user: freshUser("member@gmail.com") } });
    signOutCurrentSession.mockRejectedValueOnce(new Error("network"));
    await renderPage("/chat");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      NEW_ACCOUNT_SIGN_OUT_FAILED,
    );
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
  });
});
