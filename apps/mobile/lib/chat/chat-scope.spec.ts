/** @vitest-environment jsdom */
/**
 * The stickiness rule in `chat-scope.ts`, and the thing it must *not* depend on.
 *
 * Both failure modes here are silent. Forget to be sticky and an offline
 * member's sends stop persisting — `sendMessage` reports a queued row that was
 * never written. Make the scope depend on the chapter claim and chat sending
 * breaks outright for every member whose token carries no claim, which
 * `auth-gate.ts` documents as a normal, supported state.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: null as string | null, chapterId: null as string | null },
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => mocks.session,
}));

import { resetChatScopeMemoryForTests, useChatScope } from "./chat-scope";

function signedIn(userId: string | null, chapterId: string | null = null) {
  mocks.session = { userId, chapterId };
}

beforeEach(() => {
  resetChatScopeMemoryForTests();
  signedIn(null);
});

afterEach(() => {
  resetChatScopeMemoryForTests();
});

describe("useChatScope", () => {
  it("is null before anyone has signed in", () => {
    const { result } = renderHook(() => useChatScope());
    expect(result.current).toBeNull();
  });

  it("reports the live member", () => {
    signedIn("user-a");
    const { result } = renderHook(() => useChatScope());
    expect(result.current).toEqual({ userId: "user-a" });
  });

  it("survives the session going null while the member is merely offline", () => {
    // The access token expired and the refresh could not reach the network.
    // That is exactly when the outbox matters most, so the scope must hold —
    // otherwise `enqueue` refuses and the composed message is lost.
    signedIn("user-a");
    const { result, rerender } = renderHook(() => useChatScope());
    expect(result.current).toEqual({ userId: "user-a" });

    signedIn(null);
    rerender();

    expect(result.current).toEqual({ userId: "user-a" });
  });

  it("switches to the next member the moment they are known", () => {
    signedIn("user-a");
    const { result, rerender } = renderHook(() => useChatScope());

    signedIn("user-b");
    rerender();

    expect(result.current).toEqual({ userId: "user-b" });
  });

  it("keeps a stable identity across re-renders", () => {
    // `useChatRuntime` memoizes the stores on this, and `use-chat-channel.ts`
    // keys effects on what comes out. A new object each render would churn the
    // draft-restore effect and overwrite text typed inside the save debounce.
    signedIn("user-a");
    const { result, rerender } = renderHook(() => useChatScope());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("does not depend on the chapter claim", () => {
    // The regression guard. Mobile's chapter comes from the access token's
    // `active_chapter_id` claim, and `auth-gate.ts` establishes that its
    // absence is normal: no claim is issued for a multi-chapter member with no
    // selection, and `DB_ROLLBACK_PLAYBOOK.md` disables the hook as the first
    // auth-incident mitigation, returning every token to claim-absence.
    // `sendMessage` enqueues on EVERY send, so a scope gated on the chapter
    // would take chat sending down entirely for those members.
    signedIn("user-a", null);
    const { result, rerender } = renderHook(() => useChatScope());
    expect(result.current).toEqual({ userId: "user-a" });

    // And a chapter that arrives, or changes, must not move the scope — the
    // key would otherwise shift out from under already-queued rows.
    const before = result.current;
    signedIn("user-a", "chap-1");
    rerender();
    expect(result.current).toBe(before);

    signedIn("user-a", "chap-2");
    rerender();
    expect(result.current).toBe(before);
  });
});
