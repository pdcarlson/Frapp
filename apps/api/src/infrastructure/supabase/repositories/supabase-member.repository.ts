import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IMemberRepository } from '../../../domain/repositories/member.repository.interface';
import {
  ChapterMemberIdentity,
  Member,
} from '../../../domain/entities/member.entity';

/**
 * The wire shape of the `users!inner(id, display_name)` embed, written out
 * because the types shim cannot infer it. Every field is optional: this
 * describes what PostgREST *might* hand back, and
 * `findChapterMemberIdentities` narrows it before anything downstream sees it.
 */
interface ChapterMemberIdentityRow {
  user_id?: string | null;
  users?:
    | { id?: string | null; display_name?: string | null }
    | { id?: string | null; display_name?: string | null }[]
    | null;
}

@Injectable()
export class SupabaseMemberRepository implements IMemberRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Member | null> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByUser(userId: string): Promise<Member[]> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data || [];
  }

  async findByChapter(chapterId: string): Promise<Member[]> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return data || [];
  }

  async findChapterMemberIdentities(
    chapterId: string,
  ): Promise<ChapterMemberIdentity[]> {
    // `users!inner(...)` rather than a second round trip through
    // `userRepo.findByIds`: the inner join both drops members whose user row is
    // gone and keeps the chapter predicate in the same statement as the lookup,
    // which is this repo's multi-tenancy rule (same shape as the
    // `chat_channels!inner(chapter_id)` embeds elsewhere).
    const { data, error } = await this.supabase
      .from('members')
      .select('user_id, users!inner(id, display_name)')
      .eq('chapter_id', chapterId);
    if (error) throw error;

    // Narrowed, never cast. `database.types.ts` is a hand-rolled shim whose
    // `Relationships` are declared structurally rather than as literals, so
    // postgrest-js cannot infer an embed's shape and hands back a loose row.
    // A blind cast would turn a schema drift — an embed that arrives as an
    // array, or a null `display_name` — into an undefined flowing on to the
    // mention resolver, where it would throw inside `fold()` on the send hot
    // path. Dropping the row instead costs one member's mentionability.
    const identities: ChapterMemberIdentity[] = [];
    for (const row of (data ?? []) as unknown as ChapterMemberIdentityRow[]) {
      // PostgREST returns a many-to-one embed as an object, but returns an
      // array when it resolves the relationship the other way; accept both
      // rather than depending on which side it picked.
      const user = Array.isArray(row?.users) ? row.users[0] : row?.users;
      const userId = user?.id ?? row?.user_id;
      if (typeof userId !== 'string' || typeof user?.display_name !== 'string')
        continue;
      identities.push({ user_id: userId, display_name: user.display_name });
    }
    return identities;
  }

  async create(memberData: TablesInsert<'members'>): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .insert(memberData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    memberData: TablesUpdate<'members'>,
  ): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .update(memberData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('members').delete().eq('id', id);
    if (error) throw error;
  }

  async transferPresidencyAtomic(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
    presidentRoleId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('transfer_presidency', {
      p_chapter_id: chapterId,
      p_current_member_id: currentMemberId,
      p_target_member_id: targetMemberId,
      p_president_role_id: presidentRoleId,
    });
    if (error) throw error;
    // The RPC returns both updated member rows on success, or zero rows when the
    // current member no longer holds the President role in the chapter (race lost
    // / not eligible). The target-missing case raises in SQL and surfaces via
    // `error` above, not as a short row set.
    return (data ?? []).length === 2;
  }

  async claimPresidencyAtomic(
    chapterId: string,
    claimingMemberId: string,
    presidentRoleId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('claim_presidency', {
      p_chapter_id: chapterId,
      p_claiming_member_id: claimingMemberId,
      p_president_role_id: presidentRoleId,
    });
    if (error) throw error;
    // `false` => the chapter's needs_president flag was already clear (race
    // lost to another claimant, or the chapter no longer needs one). The
    // claiming-member-vanished case raises in SQL and surfaces via `error`.
    return data === true;
  }
}
