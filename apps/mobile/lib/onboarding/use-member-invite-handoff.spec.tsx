/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  url: null as string | null,
  destination: "tabs" as string,
  chapters: { isSuccess: true, data: [{ chapter_id: "a" }] as unknown[] },
  opened: [] as string[],
}));
vi.mock("expo-linking", () => ({ useURL: () => state.url }));
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: async (href: string) => {
    state.opened.push(href);
    return { type: "opened" };
  },
  dismissBrowser: () => {},
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
  state.opened = [];
  state.destination = "tabs";
  state.chapters = { isSuccess: true, data: [{ chapter_id: "a" }] };
  consumeRememberedInviteToken();
  // A fresh link each test: the module marks a link handled once.
  n += 1;
  state.url = `https://app.frapp.live/join?token=tok${n}`;
});

describe("useMemberInviteHandoff (#4002)", () => {
  it("opens a member's invite link on web /join, once", async () => {
    const view = renderHook(() => useMemberInviteHandoff());
    view.rerender();
    await Promise.resolve();
    expect(state.opened).toEqual([
      `https://app.frapp.live/join?token=tok${n}&web=1`,
    ]);
  });

  it("covers a member held on the Terms prompt or s03 too", async () => {
    state.destination = "terms";
    renderHook(() => useMemberInviteHandoff());
    await Promise.resolve();
    expect(state.opened).toHaveLength(1);
  });

  it("takes the invite remembered across sign-in when no link is new", async () => {
    state.url = null;
    rememberInviteToken("remembered");
    renderHook(() => useMemberInviteHandoff());
    await Promise.resolve();
    expect(state.opened).toEqual([
      "https://app.frapp.live/join?token=remembered&web=1",
    ]);
    expect(peekRememberedInviteToken()).toBeNull();
  });

  it("leaves the invite to s02 for an account with no chapter, or an unread list", async () => {
    state.chapters = { isSuccess: true, data: [] };
    renderHook(() => useMemberInviteHandoff());
    state.chapters = {
      isSuccess: false,
      data: undefined as unknown as unknown[],
    };
    renderHook(() => useMemberInviteHandoff());
    state.destination = "join";
    renderHook(() => useMemberInviteHandoff());
    await Promise.resolve();
    expect(state.opened).toEqual([]);
  });
});
