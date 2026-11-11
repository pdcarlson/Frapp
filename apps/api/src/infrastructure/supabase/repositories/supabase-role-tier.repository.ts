import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { RoleTier } from '#domain/entities/role.entity';
import { SupabaseQueryError } from '../supabase-query-error';

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
}
