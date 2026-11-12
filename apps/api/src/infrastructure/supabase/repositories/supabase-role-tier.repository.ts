import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { RoleTier } from '#domain/entities/role.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '#domain/constants/postgres-error-codes';

@Injectable()
export class SupabaseRoleTierRepository implements IRoleTierRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<RoleTier[]> {
    const { data, error } = await this.supabase
      .from('role_tiers')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('position', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async createMany(tiers: TablesInsert<'role_tiers'>[]): Promise<RoleTier[]> {
    const { data, error } = await this.supabase
      .from('role_tiers')
      .insert(tiers)
      .select();
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async create(tier: TablesInsert<'role_tiers'>): Promise<RoleTier | null> {
    const { data, error } = await this.supabase
      .from('role_tiers')
      .insert(tier)
      .select()
      .single();
    if (error) {
      // The name index (`idx_role_tiers_name`). Two officers adding a tier at
      // once can also collide on the position; the second is told the same.
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data;
  }

  async update(
    id: string,
    chapterId: string,
    changes: Pick<Partial<RoleTier>, 'name' | 'permissions'>,
  ): Promise<RoleTier | null | undefined> {
    const { data, error } = await this.supabase
      .from('role_tiers')
      .update(changes)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data ?? undefined;
  }

  async reorder(
    chapterId: string,
    ids: string[],
    fixedIds: string[],
  ): Promise<RoleTier[] | 'stale'> {
    const { data, error } = await this.supabase.rpc('reorder_role_tiers', {
      p_chapter_id: chapterId,
      p_ids: ids,
      p_fixed_ids: fixedIds,
    });
    if (error) {
      if (error.code === PG_CHECK_VIOLATION) return 'stale';
      throw new SupabaseQueryError(error);
    }
    return [...(data ?? [])].sort((a, b) => a.position - b.position);
  }

  async delete(
    id: string,
    chapterId: string,
  ): Promise<'deleted' | 'missing' | 'has_roles'> {
    const { data, error } = await this.supabase
      .from('role_tiers')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) {
      // `roles_tier_fk` does not cascade: a tier with roles stays.
      if (error.code === PG_FOREIGN_KEY_VIOLATION) return 'has_roles';
      throw new SupabaseQueryError(error);
    }
    return (data ?? []).length > 0 ? 'deleted' : 'missing';
  }
}
