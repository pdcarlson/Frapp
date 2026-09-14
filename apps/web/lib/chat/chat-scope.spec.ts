/** @vitest-environment jsdom */
/*
  The outbound scope is sticky and the read-cache scope is not, and the whole
  point of these tests is that the difference is deliberate rather than a
  leftover. An earlier revision of #2226 keyed the outbox on the live
  `useAuthUserId`, which is `null` on every mount until its effect resolves and
  `null` again for the whole of an offline period once the access token has
  expired — so the store kept nothing exactly when the outbox was the only
  thing standing between a member and a lost message.
*/
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authUserId, chapterId } = vi.hoisted(() => ({
  authUserId: vi.fn<() => string | null>(() => null),
  chapterId: vi.fn<() => string | null>(() => null),
}));
vi.mock("@/lib/auth/use-auth-user-id", () => ({ useAuthUserId: authUserId }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (select: (s: { activeChapterId: string | null }) => unknown) =>
    select({ activeChapterId: chapterId() }),
}));

import {
  resetLastKnownUserIdForTests,
  useChatDraftScope,
  useChatOutboundScope,
  useChatScope,
} from "./chat-scope";

beforeEach(() => {
  resetLastKnownUserIdForTests();
  authUserId.mockReturnValue(null);
  chapterId.mockReturnValue("chapter-1");
});

afterEach(() => {
  resetLastKnownUserIdForTests();
});

describe("useChatOutboundScope", () => {
  it("is null before any member has been seen", () => {
    const { result } = renderHook(() => useChatOutboundScope());
    expect(result.current).toBeNull();
  });

  it("survives an access token that expired offline", () => {
    /*
      `getSession()` resolves `session: null` when the token has expired and the
      refresh cannot reach the network, so the live hook reads null for as long
      as the member is offline. That is not a sign-out, and treating it as one
      is what dropped offline sends.
    */
    authUserId.mockReturnValue("auth-alice");
    const { result, rerender } = renderHook(() => useChatOutboundScope());
    expect(result.current).toEqual({
      userId: "auth-alice",
      chapterId: "chapter-1",
    });

    authUserId.mockReturnValue(null);
    rerender();

    expect(result.current).toEqual({
      userId: "auth-alice",
      chapterId: "chapter-1",
    });
  });

  it("is populated on the first render after a remount", () => {
    /*
      `useAuthUserId` restarts at null on every mount, and `ChatProvider`
      remounts on an in-app navigation to /chat while the channel list and
      `["user","me"]` are still warm — so the composer is usable before the uid
      lands. Module-scoped memory closes that window.
    */
    authUserId.mockReturnValue("auth-alice");
    renderHook(() => useChatOutboundScope()).unmount();

    authUserId.mockReturnValue(null);
    const { result } = renderHook(() => useChatOutboundScope());

    expect(result.current).toEqual({
      userId: "auth-alice",
      chapterId: "chapter-1",
    });
  });

  it("follows the incoming member on an account swap", () => {
    authUserId.mockReturnValue("auth-alice");
    const { result, rerender } = renderHook(() => useChatOutboundScope());

    authUserId.mockReturnValue("auth-bob");
    rerender();

    expect(result.current).toEqual({
      userId: "auth-bob",
      chapterId: "chapter-1",
    });
  });

  it("is null with no active chapter, because the outbox keys on one", () => {
    authUserId.mockReturnValue("auth-alice");
    chapterId.mockReturnValue(null);
    const { result } = renderHook(() => useChatOutboundScope());
    expect(result.current).toBeNull();
  });

  it("does not survive a fresh page load", () => {
    // Module memory, not storage: nothing carries into another member's session.
    authUserId.mockReturnValue("auth-alice");
    renderHook(() => useChatOutboundScope()).unmount();

    resetLastKnownUserIdForTests(); // what a new document does
    authUserId.mockReturnValue(null);

    expect(renderHook(() => useChatOutboundScope()).result.current).toBeNull();
  });
});

describe("useChatScope (the read cache's)", () => {
  it("goes cold when the live session does, rather than sticking", () => {
    /*
      The asymmetry, asserted. Serving a cached *read* under an identity that
      has gone uncertain is a tenancy risk and the cache can simply go cold;
      refusing to persist an unsent *message* loses it, which
      `spec/ui/resilience/principles.md` §5 ranks above a cold cache.
    */
    authUserId.mockReturnValue("auth-alice");
    const { result, rerender } = renderHook(() => useChatScope());
    expect(result.current).not.toBeNull();

    authUserId.mockReturnValue(null);
    rerender();

    expect(result.current).toBeNull();
  });
});

describe("useChatDraftScope", () => {
  it("carries no chapter, so it is stable across a chapter change", () => {
    /*
      Drafts key on `[userId+channelId]` and a channel id is unique across
      chapters. Handing `useChannelDraft` a chapter-bearing scope gave its
      restore effect a dependency that changes for a reason drafts do not care
      about, and the re-run drops the `typedFor` claim that protects live
      typing.
    */
    authUserId.mockReturnValue("auth-alice");
    const { result, rerender } = renderHook(() => useChatDraftScope());
    const first = result.current;
    expect(first).toEqual({ userId: "auth-alice" });

    chapterId.mockReturnValue("chapter-2");
    rerender();

    expect(result.current).toBe(first);
  });
});
