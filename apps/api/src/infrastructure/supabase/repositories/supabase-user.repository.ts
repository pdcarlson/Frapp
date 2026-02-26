import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import { User } from '../../../domain/entities/user.entity';

@Injectable()
export class SupabaseUserRepository implements IUserRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<User | null> {
    const { data } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    return data;
  }

  async findBySupabaseAuthId(authId: string): Promise<User | null> {
    const { data } = await this.supabase
      .from('users')
      .select('*')
      .eq('supabase_auth_id', authId)
      .single();
    return data;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data } = await this.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    return data;
  }

  async create(userData: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .insert(userData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .update(userData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
