import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getUser, getSession, redirect, signOutCurrentSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  signOutCurrentSession: vi.fn(async () => {}),
}));
// The new-account check's chapters read; the check itself runs for real.
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser, getSession } })),
}));
vi.mock("@/lib/auth/session", () => ({ signOutCurrentSession }));

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
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("unexpected chapters read"));
    vi.stubGlobal("fetch", fetchMock);
    redirect.mockClear();
    signOutCurrentSession.mockClear();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  /** As GoTrue hands it back on the sign-in that opened its first link. */
  function newEmailUser(email: string) {
    return {
      email,
      created_at: "2026-11-13T09:00:00.000Z",
      email_confirmed_at: "2026-11-13T09:40:00.000Z",
      last_sign_in_at: "2026-11-13T09:40:00.300Z",
      app_metadata: { provider: "email" },
      identities: [{ provider: "email" }],
    };
  }
  const chapters = (list: unknown[]) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => list });

  it("shows a brand-new magic-link account the notice (#3801)", async () => {
    getUser.mockResolvedValue({ data: { user: newEmailUser("new@school.edu") } });
    chapters([]);
    await renderPage("/chat");
    expect(redirect).not.toHaveBeenCalled();
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe(
      "Bearer tok",
    );
    expect(
      screen.getByText(
        "This is a new Frapp account for new@school.edu. Already a member? Sign out and use the method you joined with.",
      ),
    ).toBeTruthy();
  });

  it("sends an email account that belongs to a chapter straight on (#3801)", async () => {
    getUser.mockResolvedValue({ data: { user: newEmailUser("member@school.edu") } });
    chapters([{ chapter_id: "c1" }]);
    await expect(renderPage("/events")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/events");
  });

  it("sends a returning chapterless email account straight on, without reading the API (#3801)", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          ...newEmailUser("waiting@school.edu"),
          created_at: "2026-10-01T12:00:00.000Z",
          email_confirmed_at: "2026-10-01T12:03:00.000Z",
        },
      },
    });
    await expect(renderPage("/join?token=inv-1")).rejects.toThrow("NEXT_REDIRECT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/join?token=inv-1");
  });

  it("falls open to `next` when the chapters read fails (#3801)", async () => {
    getUser.mockResolvedValue({ data: { user: newEmailUser("new@school.edu") } });
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(renderPage("/chat")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/chat");
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
