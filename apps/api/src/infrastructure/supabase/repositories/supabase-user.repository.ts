import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import { User } from '../../../domain/entities/user.entity';

@Injectable()
export class SupabaseUserRepository implements IUserRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .in('id', ids);
    if (error) throw error;
    return (data as User[]) ?? [];
  }

  async findBySupabaseAuthId(authId: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('supabase_auth_id', authId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(userData: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .insert(userData as never)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .update(userData as never)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
