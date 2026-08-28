import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IRoleRepository } from '../../../domain/repositories/role.repository.interface';
import { Role } from '../../../domain/entities/role.entity';

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
    if (error) throw error;
    return data;
  }

  async findByChapter(chapterId: string): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async findByIds(ids: string[], chapterId?: string): Promise<Role[]> {
    let query = this.supabase.from('roles').select('*').in('id', ids);

    // Callers resolving a member's permissions pass their active chapter, so an
    // id that no longer belongs to it (stale membership, cross-chapter id)
    // drops out here instead of contributing another chapter's permissions.
    if (chapterId) {
      query = query.eq('chapter_id', chapterId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
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
    if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async create(roleData: TablesInsert<'roles'>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(roleData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async createMany(rolesData: TablesInsert<'roles'>[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(rolesData)
      .select();
    if (error) throw error;
    return data ?? [];
  }

  async update(id: string, roleData: TablesUpdate<'roles'>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .update(roleData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('roles').delete().eq('id', id);
    if (error) throw error;
  }
}
