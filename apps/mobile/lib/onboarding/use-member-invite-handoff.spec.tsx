/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  url: null as string | null,
  destination: "tabs" as string,
  pathname: "/" as string,
  chapters: { isSuccess: true, data: [{ chapter_id: "a" }] as unknown[] },
  pushed: [] as unknown[],
}));
vi.mock("expo-linking", () => ({ useURL: () => state.url }));
vi.mock("expo-router", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: (href: unknown) => state.pushed.push(href) }),
}));
vi.mock("@repo/hooks", () => ({ useListChapters: () => state.chapters }));
vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated" }),
}));
vi.mock("@/lib/onboarding/use-auth-gate", () => ({
  useAuthGateDestination: () => state.destination,
}));

const { useMemberInviteHandoff } = await import("./use-member-invite-handoff");
const {
  peekRememberedInviteToken,
  rememberInviteToken,
  consumeRememberedInviteToken,
} = await import("./invite-token");

let n = 0;
beforeEach(() => {
  state.pushed = [];
  state.destination = "tabs";
  state.pathname = "/";
  state.chapters = { isSuccess: true, data: [{ chapter_id: "a" }] };
  consumeRememberedInviteToken();
  // A fresh link each test: the module marks a link handled once.
  n += 1;
  state.url = `https://app.frapp.live/join?token=tok${n}`;
});

describe("useMemberInviteHandoff (#4002, #4341)", () => {
  it("opens a member's invite link on the second-chapter card, once", () => {
    const view = renderHook(() => useMemberInviteHandoff());
    view.rerender();
    expect(state.pushed).toEqual([
      { pathname: "/join-another", params: { token: `tok${n}` } },
    ]);
    // Remembered until the card joins it or the member backs out.
    expect(peekRememberedInviteToken()).toBe(`tok${n}`);
  });

  it("doesn't reopen the card a member swiped away, until a link opens it again", () => {
    const view = renderHook(() => useMemberInviteHandoff());
    state.pathname = "/join-another";
    view.rerender();
    // iOS's edge swipe back to the tabs, the invite still remembered.
    state.pathname = "/";
    view.rerender();
    expect(state.pushed).toHaveLength(1);
    // The same link tapped again is a fresh ask.
    n += 1;
    state.url = `https://app.frapp.live/join?token=tok${n}`;
    view.rerender();
    expect(state.pushed).toEqual([
      { pathname: "/join-another", params: { token: `tok${n - 1}` } },
      { pathname: "/join-another", params: { token: `tok${n}` } },
    ]);
  });

  it("holds the invite while the Terms prompt or s03 is up, then opens it", () => {
    state.destination = "terms";
    const view = renderHook(() => useMemberInviteHandoff());
    expect(state.pushed).toEqual([]);
    expect(peekRememberedInviteToken()).toBe(`tok${n}`);
    state.destination = "tabs";
    view.rerender();
    expect(state.pushed).toEqual([
      { pathname: "/join-another", params: { token: `tok${n}` } },
    ]);
  });

  it("leaves a link on /join to the (auth) layout, and the open card alone", () => {
    state.pathname = "/join";
    renderHook(() => useMemberInviteHandoff());
    state.pathname = "/join-another";
    renderHook(() => useMemberInviteHandoff());
    expect(state.pushed).toEqual([]);
  });

  it("takes the invite remembered across sign-in when no link is new", () => {
    state.url = null;
    rememberInviteToken("remembered");
    renderHook(() => useMemberInviteHandoff());
    expect(state.pushed).toEqual([
      { pathname: "/join-another", params: { token: "remembered" } },
    ]);
  });

  it("leaves the invite to s02 for an account with no chapter, or an unread list", () => {
    state.chapters = { isSuccess: true, data: [] };
    renderHook(() => useMemberInviteHandoff());
    state.chapters = {
      isSuccess: false,
      data: undefined as unknown as unknown[],
    };
    renderHook(() => useMemberInviteHandoff());
    state.destination = "join";
    renderHook(() => useMemberInviteHandoff());
    expect(state.pushed).toEqual([]);
    expect(peekRememberedInviteToken()).toBeNull();
  });
});
