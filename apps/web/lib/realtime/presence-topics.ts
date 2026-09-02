/**
 * The chapter-presence topic contract.
 *
 * Deliberately separate from chat's `chat:channel:<id>` topic. That one is a
 * cross-service contract — the push worker reads presence on it via service
 * role to skip recipients who are already looking at the channel (ADR-10) —
 * and `packages/chat-core/src/presence-contract.test.ts` pins both its channel
 * config and its `{ userId, ts }` payload byte-for-byte. Re-keying it or
 * widening its payload silently disables push suppression, which is why the
 * directory gets its own topic instead of borrowing that one.
 *
 * The two also answer different questions. Chat presence knows who has a
 * *particular channel* open; the directory needs who is present in the
 * *chapter* at all, including members who are not in chat right now.
 *
 * **This is a public channel, not a `private: true` one.** The private-channel
 * authoriser `realtime_messages_scoped_select`
 * (`supabase/migrations/20260816140000_realtime_carrier_repair.sql`) matches
 * three topic shapes and ends in `else false`, so a private presence topic
 * would be denied for every subscriber until that policy grew a fourth branch
 * — an RLS migration. Chat presence is already public for the same payload, so
 * this follows the shipped precedent rather than changing the auth substrate.
 * The tradeoff, recorded rather than buried: a holder of the anon key and a
 * chapter UUID can observe which *user ids* are currently present in that
 * chapter. No names, no email — the payload is ids and a timestamp.
 *
 * Kept tiny and dependency-free so the pin test can import it without pulling
 * in React or the Supabase client, matching `change-topics.ts`.
 */

/**
 * Builds the presence topic for a chapter.
 *
 * Distinct prefix from the `events:<chapterId>` change topic, which is also
 * keyed by chapter id: the two carry different things and must not collide on
 * one channel instance. `topic-registry.ts` keys the whole attach/release queue
 * by topic string, so a collision would make one subscription tear the other
 * down on every re-attach.
 */
export function chapterPresenceTopic(chapterId: string): string {
  return `presence:chapter:${chapterId}`;
}

/** The presence payload this app tracks. `ts` is last *activity*, not last heartbeat. */
export type ChapterPresencePayload = {
  userId: string;
  ts: number;
};
