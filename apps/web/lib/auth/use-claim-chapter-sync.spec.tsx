/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthCallback = (event: string, session: { access_token: string } | null) => void;

const { listeners, unsubscribe, store } = vi.hoisted(() => {
  const listeners: AuthCallback[] = [];
  const store = {
    activeChapterId: null as string | null,
    setActiveChapterId: vi.fn((id: string | null) => {
      store.activeChapterId = id;
    }),
  };
  return { listeners, unsubscribe: vi.fn(), store };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe } } };
      },
    },
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: Object.assign(() => null, { getState: () => store }),
}));

const { useClaimChapterSync } = await import("./use-claim-chapter-sync");

const b64url = (obj: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const tokenFor = (chapter?: string) =>
  `${b64url({ alg: "ES256" })}.${b64url(chapter ? { active_chapter_id: chapter } : { sub: "u" })}.sig`;

const emit = (event: string, chapter?: string | null) =>
  listeners.forEach((cb) =>
    cb(event, chapter === null ? null : { access_token: tokenFor(chapter) }),
  );

describe("useClaimChapterSync", () => {
  beforeEach(() => {
    listeners.length = 0;
    unsubscribe.mockClear();
    store.activeChapterId = null;
    store.setActiveChapterId.mockClear();
  });

  it("seeds an empty store from the INITIAL_SESSION claim", () => {
    renderHook(() => useClaimChapterSync());
    emit("INITIAL_SESSION", "chap-1");
    expect(store.setActiveChapterId).toHaveBeenCalledWith("chap-1");
    expect(store.activeChapterId).toBe("chap-1");
  });

  it("corrects a store that disagrees with the claim — the claim is the authority", () => {
    store.activeChapterId = "stale-chapter";
    renderHook(() => useClaimChapterSync());
    emit("TOKEN_REFRESHED", "chap-2");
    expect(store.setActiveChapterId).toHaveBeenCalledWith("chap-2");
  });

  it("does not write when the store already matches, so no cache drop is triggered", () => {
    store.activeChapterId = "chap-1";
    renderHook(() => useClaimChapterSync());
    emit("INITIAL_SESSION", "chap-1");
    emit("SIGNED_IN", "chap-1");
    expect(store.setActiveChapterId).not.toHaveBeenCalled();
  });

  it("leaves the store alone on a steady-state event whose token has no claim", () => {
    store.activeChapterId = "chap-1";
    renderHook(() => useClaimChapterSync());
    emit("INITIAL_SESSION"); // several chapters, no live choice — the picker's case
    emit("TOKEN_REFRESHED");
    emit("USER_UPDATED");
    expect(store.setActiveChapterId).not.toHaveBeenCalled();
    expect(store.activeChapterId).toBe("chap-1");
  });

  it("leaves the store alone when an event arrives with no session at all", () => {
    store.activeChapterId = "chap-1";
    renderHook(() => useClaimChapterSync());
    emit("INITIAL_SESSION", null);
    expect(store.setActiveChapterId).not.toHaveBeenCalled();
  });

  // The account boundary: the previous account's chapter must not survive in
  // this browser's storage into the next account's session.
  it("clears the store on SIGNED_OUT", () => {
    store.activeChapterId = "chap-1";
    renderHook(() => useClaimChapterSync());
    emit("SIGNED_OUT", null);
    expect(store.setActiveChapterId).toHaveBeenCalledWith(null);
    expect(store.activeChapterId).toBeNull();
  });

  it("clears the store when a SIGNED_IN token carries no claim (a different account, or one with no chapter)", () => {
    store.activeChapterId = "previous-accounts-chapter";
    renderHook(() => useClaimChapterSync());
    emit("SIGNED_IN");
    expect(store.setActiveChapterId).toHaveBeenCalledWith(null);
  });

  it("replaces the previous account's chapter with the new account's claim on SIGNED_IN", () => {
    store.activeChapterId = "previous-accounts-chapter";
    renderHook(() => useClaimChapterSync());
    emit("SIGNED_IN", "new-accounts-chapter");
    expect(store.setActiveChapterId).toHaveBeenCalledWith("new-accounts-chapter");
  });

  it("does not write null twice", () => {
    store.activeChapterId = null;
    renderHook(() => useClaimChapterSync());
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN");
    expect(store.setActiveChapterId).not.toHaveBeenCalled();
  });

  it("ignores events that carry no fresh token decision", () => {
    renderHook(() => useClaimChapterSync());
    emit("PASSWORD_RECOVERY", "chap-1");
    emit("MFA_CHALLENGE_VERIFIED", "chap-1");
    expect(store.setActiveChapterId).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useClaimChapterSync());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
