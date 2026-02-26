import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IRoleRepository } from '../../../domain/repositories/role.repository.interface';
import { Role } from '../../../domain/entities/role.entity';

@Injectable()
export class SupabaseRoleRepository implements IRoleRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<Role | null> {
    const { data } = await this.supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .single();
    return data;
  }

  async findByChapter(chapterId: string): Promise<Role[]> {
    const { data } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('display_order', { ascending: true });
    return data || [];
  }

  async findByIds(ids: string[]): Promise<Role[]> {
    const { data } = await this.supabase
      .from('roles')
      .select('*')
      .in('id', ids);
    return data || [];
  }

  async findByChapterAndName(
    chapterId: string,
    name: string,
  ): Promise<Role | null> {
    const { data } = await this.supabase
      .from('roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name', name)
      .single();
    return data;
  }

  async create(roleData: Partial<Role>): Promise<Role> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(roleData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, roleData: Partial<Role>): Promise<Role> {
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
