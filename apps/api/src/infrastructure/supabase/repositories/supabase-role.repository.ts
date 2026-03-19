import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
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

  async createMany(rolesData: Partial<Role>[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(rolesData as never)
      .select();
    if (error) throw error;
    return data ?? [];
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

  async findByIds(ids: string[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .in('id', ids);
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

  async create(roleData: Partial<Role>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(roleData as never)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, roleData: Partial<Role>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .update(roleData as never)
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
