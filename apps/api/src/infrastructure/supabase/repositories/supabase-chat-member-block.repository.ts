import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatMemberBlockRepository } from '#domain/repositories/chat-moderation.repository.interface';
import type { ChatMemberBlockRef } from '#domain/entities/chat-moderation.entity';

/**
 * Per-chapter member block list (#2257).
 *
 * Every query filters on **both** `chapter_id` and `blocker_user_id`. The
 * chapter predicate is the ordinary tenancy rule — a block is scoped to one
 * chapter, because a member can belong to several and blocking someone in one
 * says nothing about another. The blocker predicate is the privacy guarantee:
 * `spec/behavior/chat/README.md` requires that a blocked member cannot discover
 * the block, so there is no method here that takes a `blocked_user_id` alone
 * and no way to ask "who has blocked me". A query that scoped chapter but not
 * blocker would sail through a tenancy check and still answer that question.
 *
 * The table enables RLS with zero policies and the API reaches it with the
 * service-role key. That default-deny is the safety guarantee rather than the
 * convention here: the tempting "members can read their own block list" policy
 * is one edit away from a symmetric version that tells an abuser exactly who
 * has blocked them, and with no policy at all there is no client-reachable read
 * path to get that predicate wrong.
 */
@Injectable()
export class SupabaseChatMemberBlockRepository implements IChatMemberBlockRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * The hot read: "the set of user ids I have blocked in this chapter".
   *
   * Served by the `(chapter_id, blocker_user_id, blocked_user_id)` unique
   * constraint's implicit index — which is why the migration deliberately does
   * *not* add a second `(blocker_user_id, chapter_id)` index for it.
   */
  async findBlockedUserIds(
    chapterId: string,
    blockerUserId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('chat_member_blocks')
      .select('blocked_user_id')
      .eq('chapter_id', chapterId)
      .eq('blocker_user_id', blockerUserId);
    if (error) throw error;
    return (data ?? []).map((row) => row.blocked_user_id);
  }

  /**
   * The inverse read, bounded by a candidate set the caller already holds.
   *
   * This is the one query in this file that filters on `blocked_user_id`, and
   * it is the shape the class docblock warns about — so the bound is not
   * optional. `candidateBlockerUserIds` is the push worker's already-authorized
   * audience for one channel, and the `.in()` is what keeps this "which of
   * these recipients must not be delivered to" rather than "who has blocked
   * this member". An empty candidate list short-circuits without a query: a
   * bare `.in('blocker_user_id', [])` is a well-formed PostgREST filter that
   * matches nothing, so the guard is for the round trip, not for correctness.
   *
   * Served by the same `(chapter_id, blocker_user_id, blocked_user_id)` unique
   * index as {@link findBlockedUserIds} — the leading `chapter_id` and the
   * trailing equality make it an index scan, not a sequential one.
   */
  async findBlockersAmong(
    chapterId: string,
    blockedUserId: string,
    candidateBlockerUserIds: string[],
  ): Promise<Set<string>> {
    if (candidateBlockerUserIds.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from('chat_member_blocks')
      .select('blocker_user_id')
      .eq('chapter_id', chapterId)
      .eq('blocked_user_id', blockedUserId)
      .in('blocker_user_id', candidateBlockerUserIds);
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.blocker_user_id));
  }

  /**
   * Idempotent by construction.
   *
   * `(chapter_id, blocker_user_id, blocked_user_id)` is a plain UNIQUE
   * constraint, so unlike the report index PostgREST *can* use it as an
   * `ON CONFLICT` arbiter. `ignoreDuplicates: false` returns the existing row on
   * a repeat rather than raising `23505`; `created_at` is not in the payload, so
   * the original block time survives the repeat.
   */
  async create(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<ChatMemberBlockRef> {
    const payload: TablesInsert<'chat_member_blocks'> = {
      chapter_id: chapterId,
      blocker_user_id: blockerUserId,
      blocked_user_id: blockedUserId,
    };
    const { data, error } = await this.supabase
      .from('chat_member_blocks')
      .upsert(payload, {
        onConflict: 'chapter_id,blocker_user_id,blocked_user_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();
    if (error) throw error;
    return stripBlockRow(data);
  }

  /**
   * Unblock. Matches on all three columns, so a caller can only ever remove
   * their own row in their own chapter, and a miss is silently a no-op.
   */
  async delete(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_member_blocks')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('blocker_user_id', blockerUserId)
      .eq('blocked_user_id', blockedUserId);
    if (error) throw error;
  }
}

/**
 * Drops `blocker_user_id` on every exit, mirroring `stripBookmarkRow`.
 *
 * Nothing serializes to the declared DTO in this app, so the strip — not
 * `ChatBlockDto` — is what keeps the field off the wire. It is the caller's own
 * id today and therefore not itself a breach; the point is that "who has
 * blocked whom" must never be a field a client can read off a block response,
 * because the day the shape is reused for a second viewer the DTO will still
 * say it is not there.
 */
function stripBlockRow(row: Record<string, unknown>): ChatMemberBlockRef {
  const rest = { ...row };
  delete (rest as { blocker_user_id?: unknown }).blocker_user_id;
  return rest as unknown as ChatMemberBlockRef;
}
