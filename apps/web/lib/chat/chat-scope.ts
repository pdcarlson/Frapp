"use client";

/**
 * The chat half of tenant scoping: which scope the inbound first-chunk read
 * cache (`first-chunk-cache.ts`) reads, and the two *different* answers the
 * outbound drafts/outbox database (`offline-queue.ts`) needs.
 *
 * The plain live scope is no longer defined here. It moved to
 * `@/lib/tenancy/scope` when the chapter accent cache became a second
 * shell-path caller, and this file re-exports it under its chat name so no
 * call site changed. The reason it is re-exported rather than re-derived is
 * the one this header has always given: both caches key their rows on the
 * scope and both treat that key as a security boundary, so two derivations of
 * "who is this" would be two things that can drift apart — and the drift would
 * not look like a bug until a row written under one definition was read under
 * the other. That argument never depended on chat.
 *
 * What stays here is what is genuinely chat's: the **sticky** variants. Both
 * halves still come from local state rather than the network — the Supabase
 * session and the persisted chapter store — which is the only reason a cold
 * load can read the cache, or an offline composer write a draft, before
 * `GET /v1/channels` returns.
 */

import { useEffect, useMemo } from "react";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useTenantScope, type TenantScope } from "@/lib/tenancy/scope";

/**
 * The member — and the chapter — a persisted chat row belongs to.
 *
 * An alias, not a second declaration: see the header.
 */
export type ChatScope = TenantScope;

/**
 * The draft scope: the member alone.
 *
 * A channel id is a UUID unique across chapters, so `[userId+channelId]`
 * isolates a draft completely and a chapter segment would be redundant
 * structure. `offline-queue.ts` has the full argument for why the *outbox* is
 * the one that does need the chapter.
 */
export type ChatDraftScope = Pick<ChatScope, "userId">;

/**
 * `null` until both halves are known.
 *
 * Delegates to `useTenantScope` — see the header for why this is a re-export
 * and not a second derivation. Kept under its chat name because
 * `use-first-chunk-cache.ts` re-exports it again as `useFirstChunkScope`, and
 * renaming through two hops buys nothing.
 */
export function useChatScope(): ChatScope | null {
  return useTenantScope();
}

/**
 * The last member this page session saw signed in, held in module memory.
 *
 * `useAuthUserId` answers "is there a valid session **right now**", which is a
 * different question from "whose browser is this", and the difference is what
 * the outbound store must not get wrong. It is `null` in two situations that
 * look identical to a caller and are not:
 *
 * 1. It has not resolved yet. Its state starts `null` on **every mount**, and
 *    `ChatProvider` remounts on an in-app navigation to `/chat` while
 *    `["user","me"]` and the channel list are still warm in the QueryClient —
 *    so the composer is fully usable before the uid lands.
 * 2. The access token expired and the refresh could not reach the network.
 *    `getSession()` resolves `session: null` there, so this stays `null` for as
 *    long as the member is offline — which is precisely when the outbox is the
 *    only thing standing between them and a lost message.
 *
 * Neither means "signed out", and treating them as such is what made an earlier
 * revision of this change drop offline sends on the floor: an unscoped store
 * kept nothing while `sendMessage` believed the row was durably queued.
 *
 * So the last non-null uid is remembered and never revoked. It is module state,
 * not storage: a fresh page load starts empty, so nothing survives into another
 * member's session. Going stale requires *nobody* to be signed in — a real
 * sign-out fires an auth event and `FrappProvider` holds a `useAuthUserId`
 * subscription on the shell path of every dashboard route, so the next member
 * replaces this before any chat surface mounts. And while nobody is signed in,
 * `sendMessage` and `flushOutbox` both refuse on `ctx.userId` anyway, so a
 * stale value here has nothing to act on.
 */
let lastKnownUserId: string | null = null;

/** Test seam — module state outlives a `renderHook`, so specs must reset it. */
export function resetLastKnownUserIdForTests(): void {
  lastKnownUserId = null;
}

function useStickyAuthUserId(): string | null {
  const live = useAuthUserId();
  /*
    Recorded in an effect, not during render: reassigning module state while
    rendering is a side effect React is free to run twice or discard, and
    `react-hooks/globals` rejects it. Writing after commit loses nothing,
    because the read below always prefers the live value — the remembered one
    is consulted only on a render where `useAuthUserId` has not (yet, or no
    longer) got an answer, and by then some earlier commit has recorded it.
  */
  useEffect(() => {
    if (live) lastKnownUserId = live;
  }, [live]);
  return live ?? lastKnownUserId;
}

/**
 * `null` until the session is known — and **stable across a chapter change**,
 * which is the point of it being separate.
 *
 * Drafts do not key on the chapter, so handing `useChannelDraft` the full scope
 * would give its restore effect a dependency that changes for a reason drafts
 * do not care about. A chapter that moves under a mounted composer — a
 * `TOKEN_REFRESHED` that `useClaimChapterSync` writes through, `/join` or the
 * onboarding wizard, both of which switch in place with no navigation — would
 * then tear the effect down and re-run it, and its cleanup drops the
 * `typedFor` claim that protects live typing: the restore that follows sees an
 * unclaimed channel and overwrites the composer with the last value on disk,
 * silently discarding anything typed inside the 400ms save debounce.
 */
export function useChatDraftScope(): ChatDraftScope | null {
  const userId = useStickyAuthUserId();
  return useMemo(() => (userId ? { userId } : null), [userId]);
}

/**
 * The scope the outbound drafts/outbox database keys on.
 *
 * Sticky, unlike {@link useChatScope}, which the first-chunk **read** cache
 * uses. The two caches want different answers from the same question and the
 * asymmetry is deliberate: serving a read from a cache whose identity has gone
 * uncertain is a tenancy risk, so the read cache prefers to go cold; refusing
 * to persist an unsent message because identity has gone uncertain loses the
 * message, which `spec/ui/resilience/principles.md` §5 ranks above it.
 */
export function useChatOutboundScope(): ChatScope | null {
  const userId = useStickyAuthUserId();
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return useMemo(
    () => (userId && chapterId ? { userId, chapterId } : null),
    [userId, chapterId],
  );
}
