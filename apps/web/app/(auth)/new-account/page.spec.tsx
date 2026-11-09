import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getUser, redirect, signOutCurrentSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  signOutCurrentSession: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock("@/lib/auth/session", () => ({ signOutCurrentSession }));

import NewAccountPage from "./page";

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
    redirect.mockClear();
    signOutCurrentSession.mockClear();
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
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
    expect(signOutCurrentSession).toHaveBeenCalledTimes(1);
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
});
