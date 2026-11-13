import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IRoleRepository,
  RoleDeletion,
} from '#domain/repositories/role.repository.interface';
import { Role } from '#domain/entities/role.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { readOncePerRequest, readSharedInBurst } from '../request-reads';

/**
 * The roles a member holds, by id, optionally re-scoped to one chapter.
 * `PermissionsGuard` and `RbacService.getChannelAccessHolder` both ask this for
 * the caller's `role_ids`, so it is read once per request (`request-reads.ts`,
 * #3728) and exported for the guard, which cannot inject the repository. The
 * key sorts the ids, because the answer does not depend on their order.
 */
export function readRolesByIds(
  supabase: FrappSupabaseClient,
  ids: readonly string[],
  chapterId?: string,
): Promise<Role[]> {
  const key = rolesReadKey(ids, chapterId);
  return readOncePerRequest(key, () =>
    readSharedInBurst(key, async () => {
      let query = supabase
        .from('roles')
        .select('*')
        .in('id', [...ids]);

      // Callers resolving a member's permissions pass their active chapter, so an
      // id that no longer belongs to it (stale membership, cross-chapter id)
      // drops out here instead of contributing another chapter's permissions.
      if (chapterId) {
        query = query.eq('chapter_id', chapterId);
      }

      const { data, error } = await query;
      if (error) throw new SupabaseQueryError(error);
      return data || [];
    }),
  );
}

/** The request-store key `readRolesByIds` reads under. */
export function rolesReadKey(
  ids: readonly string[],
  chapterId?: string,
): string {
  return `roles:${chapterId ?? '*'}:${[...ids].sort().join(',')}`;
}

@Injectable()
export class SupabaseRoleRepository implements IRoleRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Role | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(chapterId: string): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('display_order', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findByIds(ids: string[], chapterId?: string): Promise<Role[]> {
    return readRolesByIds(this.supabase, ids, chapterId);
  }

  async findByChapterAndName(
    chapterId: string,
    name: string,
  ): Promise<Role | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapterAndSystemKey(
    chapterId: string,
    systemKey: string,
  ): Promise<Role | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('system_key', systemKey)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(roleData: TablesInsert<'roles'>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(roleData)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async createMany(rolesData: TablesInsert<'roles'>[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(rolesData)
      .select();
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async update(id: string, roleData: TablesUpdate<'roles'>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .update(roleData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async delete(chapterId: string, id: string): Promise<RoleDeletion | null> {
    const { data, error } = await this.supabase.rpc('delete_role', {
      p_chapter_id: chapterId,
      p_role_id: id,
    });
    if (error) throw new SupabaseQueryError(error);
    if (!data) return null;
    return {
      strippedMemberIds: data.stripped_member_ids ?? [],
      givenEveryoneMemberIds: data.given_everyone_member_ids ?? [],
    };
  }
}
