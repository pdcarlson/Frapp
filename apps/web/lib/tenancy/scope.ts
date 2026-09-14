"use client";

/**
 * The tenant whose data this browser may read, write and paint.
 *
 * One home for the pair, because more than one surface now keys persisted
 * state on it and every one of them treats that key as a security boundary:
 *
 *  - the chat first-chunk read cache and the outbound drafts/outbox database
 *    (`lib/chat/chat-scope.ts`, which re-exports this),
 *  - the chapter accent cache (`lib/theme/accent-cache.ts`), which paints a
 *    remembered accent before the network answers.
 *
 * `chat-scope.ts` used to own the definition and said why in its own header:
 * "two derivations of 'who is this' would be two things that can drift apart —
 * and the drift would not look like a bug until a row written under one
 * definition was read under the other." That argument did not depend on chat;
 * it only ever lived there because chat was the first caller. The accent cache
 * is on the **shell** path, which `lib/chat/` is not, so the definition moved
 * up to a neutral home rather than being copied into a second one.
 *
 * Both halves come from local state rather than the network — the Supabase
 * session (`useAuthUserId`) and the persisted chapter store — which is the only
 * reason a cold load can read a cache, or an offline composer write a draft,
 * before any request returns.
 *
 * Deliberately **not** gated on the chapter store's `hasHydrated`.
 * `profile-panel.tsx` records at length that the flag has three ways to stick
 * at `false` for the life of a session when `localStorage` throws; gating here
 * would silently disable every cache keyed on this scope for exactly those
 * members, and nothing else in the shell waits on it either.
 */

import { useMemo } from "react";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { useChapterStore } from "@/lib/stores/chapter-store";

/** The member — and the chapter — a persisted row or a painted accent belongs to. */
export interface TenantScope {
  /** Supabase auth uid (JWT subject) — not `users.id`. */
  userId: string;
  chapterId: string;
}

/**
 * `null` until both halves are known.
 *
 * Live, not sticky: it answers "is there a valid session **right now**", so it
 * goes `null` while `useAuthUserId`'s effect resolves and for the whole of an
 * offline period once the access token has expired. Read caches may safely go
 * cold on that uncertainty — `spec/ui/resilience/caching.md` has the full
 * argument, and the sticky variant an *outbox* needs instead lives beside the
 * outbox in `lib/chat/chat-scope.ts`.
 */
export function useTenantScope(): TenantScope | null {
  const userId = useAuthUserId();
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return useMemo(
    () => (userId && chapterId ? { userId, chapterId } : null),
    [userId, chapterId],
  );
}
