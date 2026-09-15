/**
 * The mobile half of chat tenant scoping: which member a persisted outbound row
 * belongs to.
 *
 * Web's equivalent is `apps/web/lib/chat/chat-scope.ts`, and the *reasoning*
 * there applies here unchanged — keying is the security boundary, not the wipe
 * (`spec/ui/resilience/caching.md`). The mechanics differ, so this is a sibling
 * rather than a port:
 *
 * - **Storage.** Web keys Dexie rows on a compound primary key. AsyncStorage
 *   has one flat string keyspace and no compound keys, so the scope is spelled
 *   into the key string itself (`outbox-store.ts`, `draft-store.ts`). A row
 *   belonging to another member is not filtered out of `listQueued` — there is
 *   no key under which this scope can reach it.
 * - **Identity source.** Web reads `useAuthUserId`; mobile reads
 *   {@link useAuthSession}, which already derives the Supabase auth uid for the
 *   #2091 cache clear. Not a second definition of "who is this" — #2228 is
 *   explicit that mobile must not fork one.
 *
 * ## Why the chapter is not in the mobile key, though it is in web's
 *
 * Web keys outbox rows on `userId + chapterId`, to stop a row queued in one
 * chapter from flushing in another — a send carries the active chapter in a
 * header that `ChatService.sendMessage` checks against the channel, so a
 * mismatch is a 4xx. Mobile deliberately keys on the member alone, for two
 * reasons that only apply here.
 *
 * **The chapter is not reliably known.** Web reads a *persisted* store, so a
 * chapter it has ever seen survives a reload. Mobile's only source is the
 * access token's `active_chapter_id` claim, and `lib/auth-gate.ts` spends
 * thirty lines establishing that the absence of that claim is a normal,
 * supported state rather than a fault: the hook issues no claim for a
 * multi-chapter member with no selection, `ChapterGuard` auto-resolves a sole
 * membership server-side from the header instead, and `DB_ROLLBACK_PLAYBOOK.md`
 * disables the hook as the first auth-incident mitigation — which returns
 * *every* token to claim-absence. `auth-session.tsx` is equally explicit that a
 * null `chapterId` means "not resolved yet" and "no chapter" indistinguishably.
 *
 * Putting it in the key would therefore have turned an optimization into a
 * requirement. `sendMessage` enqueues on **every** send, online included
 * (`packages/chat-core/src/chat-client.ts`), so a scope that went null without
 * the claim would not degrade offline sending — it would take chat sending down
 * entirely for those members, and for everyone at once during the incident the
 * rollback playbook exists to mitigate. A tenant fix that can cause a total
 * send outage is not a tenant fix.
 *
 * **And it would not have bought the protection anyway.** The chapter can move
 * under an in-flight flush: `chat-thread.tsx` is a `Tabs.Screen` that stays
 * mounted across a chapter switch, and a `flushOutbox` already looping holds
 * the store it started with while `apiClient` reads the *current* bearer per
 * request. So the mismatched POST is reachable whatever the key looks like.
 * What it produces is a 403 the flush records with `markFailed` — a visible,
 * retryable failed bubble, not a silently burned message. Keying the chapter
 * would have traded that visible failure for an invisible one: rows stranded
 * under a chapter the member is no longer in, which no mobile surface lists.
 *
 * The member, meanwhile, *is* the boundary #2228 is about — cross-account
 * authorship — and it is reliably known, so that is what the key carries.
 *
 * ## `userId` is the Supabase auth uid, not `users.id`
 *
 * The same choice web made, for the same reason: the uid is the JWT subject
 * the flush will POST under, so "rows this scope can see" and "rows this token
 * may author" are the same set. `chat_messages.sender_id` references
 * `users(id)` and `useChatRuntime` still passes *that* as `ctx.userId` for
 * attribution and own-message styling — the two are different columns doing
 * different jobs, and this one is the tenant boundary.
 */

import { useEffect, useMemo } from "react";

import { useAuthSession } from "@/lib/auth-session";

/**
 * The member an outbox row or draft is keyed under.
 *
 * One shape for both, unlike web, where the outbox additionally carries the
 * chapter — see the header for why mobile's does not.
 */
export interface ChatScope {
  userId: string;
}

/**
 * The last member seen signed in during this app process.
 *
 * `useAuthSession().userId` answers "is there a valid session right now", which
 * is a different question from "whose phone is this". It is `null` in two
 * situations a caller cannot tell apart, and neither means signed out:
 *
 * 1. It has not resolved yet — `status` starts `"hydrating"` on a cold start,
 *    and `userId` is `session?.user?.id ?? null` until the session lands.
 * 2. The access token expired and the refresh could not reach the network, so
 *    `getSession()` resolves `session: null` for the whole of an offline
 *    period — which is precisely when the outbox is the only thing standing
 *    between the member and a lost message.
 *
 * Treating either as "signed out" is what makes an unscoped store drop offline
 * sends on the floor: `sendMessage` believes the row was durably queued while
 * the store kept nothing. So the last non-null uid is remembered and never
 * revoked.
 *
 * It is module state, not storage: a fresh process starts empty, so nothing
 * survives into another member's session. Going stale requires *nobody* to be
 * signed in, and the next member to sign in replaces it before any chat surface
 * can write.
 *
 * Note this is the *session* uid, which survives a cold start because Supabase
 * persists the session to SecureStore — unlike the chapter claim, whose read is
 * a network round trip. That asymmetry is the whole reason the header above
 * gives for keying on the member and not the chapter.
 */
let lastKnownUserId: string | null = null;

/** Test seam — module state outlives a `renderHook`, so specs must reset it. */
export function resetChatScopeMemoryForTests(): void {
  lastKnownUserId = null;
}

/**
 * `null` only when nobody is, or has been, signed in during this process.
 *
 * The remembering happens in an effect rather than during render: reassigning
 * module state while rendering is a side effect React is free to run twice or
 * discard, and `react-hooks/globals` rejects it. Writing after commit loses
 * nothing — the read always prefers the live value, and consults the memory
 * only on a render where the session has not (yet, or no longer) got an answer.
 */
export function useChatScope(): ChatScope | null {
  const { userId: live } = useAuthSession();

  useEffect(() => {
    if (live) lastKnownUserId = live;
  }, [live]);

  const userId = live ?? lastKnownUserId;
  return useMemo(() => (userId ? { userId } : null), [userId]);
}
