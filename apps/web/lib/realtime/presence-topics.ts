/**
 * The chapter-presence topic contract.
 *
 * Deliberately separate from chat's `chat:channel:<id>` topic. That one is a
 * cross-service contract — the push worker reads presence on it via service
 * role to skip recipients who are already looking at the channel (ADR-10) —
 * and `packages/chat-core/src/presence-contract.spec.ts` pins both its channel
 * config and its `{ userId, ts }` payload byte-for-byte. Re-keying it or
 * widening its payload silently disables push suppression, which is why the
 * directory gets its own topic instead of borrowing that one.
 *
 * The two also answer different questions. Chat presence knows who has a
 * *particular channel* open; the directory needs who is present in the
 * *chapter* at all, including members who are not in chat right now.
 *
 * **This is a `private: true` channel since #1552 (2026-09-06).** The
 * private-channel authoriser `realtime_messages_scoped_select` ends in
 * `else false`, so a private topic is denied for every subscriber until the
 * policy carries an arm for it; migration
 * `20260906203000_realtime_presence_private.sql` added that arm (chapter
 * membership) and the matching INSERT policy that lets a member `track()`. The
 * hook's `private: true` and that migration are one change — a private topic
 * whose arm is missing joins, reports SUBSCRIBED and delivers nothing.
 *
 * What that closes, and what it does not, recorded rather than buried. Closed:
 * a holder of the anon key (it ships in the browser bundle) and a chapter UUID
 * can no longer *read* which user ids are present, nor *write* an entry — both
 * now need a JWT for a member of that chapter. Not closed: presence identity is
 * still taken from the payload rather than bound to the caller's JWT (Realtime
 * policies see the topic and the message extension, not the tracked state), so
 * a chapter MEMBER can still `track({ userId: <another member> })`. Presence
 * therefore stays advisory and is never an input to an authorization decision.
 * Chat's `chat:channel:<id>` topic went private in the same change, behind a
 * per-channel predicate (`can_read_chat_channel`) rather than chapter
 * membership, so DM and role-gated presence is not visible chapter-wide.
 * Canonical home for the authorisation half:
 * `docs/internal/security/AUTHORIZATION_MODEL.md` § "The policies that do
 * exist".
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
 *
 * The topic is PRIVATE (#1552): `realtime_messages_scoped_select` and
 * `realtime_messages_scoped_insert` on `realtime.messages` match exactly this
 * prefix + a UUID and admit chapter members only, so an anon-key holder can
 * neither read the roster nor publish an entry. A chapter member can still
 * `track()` another member's id — Realtime policies see the topic and the
 * message extension, not the presence payload — so presence stays advisory
 * (`AUTHORIZATION_MODEL.md`). Changing the prefix here without a matching
 * policy branch turns the Directory silently empty; grep the migrations first.
 */
export function chapterPresenceTopic(chapterId: string): string {
  return `presence:chapter:${chapterId}`;
}
