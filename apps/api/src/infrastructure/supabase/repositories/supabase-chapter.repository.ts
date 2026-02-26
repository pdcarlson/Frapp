import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IChapterRepository } from '../../../domain/repositories/chapter.repository.interface';
import { Chapter } from '../../../domain/entities/chapter.entity';

@Injectable()
export class SupabaseChapterRepository implements IChapterRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<Chapter | null> {
    const { data } = await this.supabase.from('chapters').select('*').eq('id', id).single();
    return data;
  }

  async findByStripeCustomerId(customerId: string): Promise<Chapter | null> {
    const { data } = await this.supabase.from('chapters').select('*').eq('stripe_customer_id', customerId).single();
    return data;
  }

  async create(chapterData: Partial<Chapter>): Promise<Chapter> {
    const { data, error } = await this.supabase.from('chapters').insert(chapterData).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, chapterData: Partial<Chapter>): Promise<Chapter> {
    const { data, error } = await this.supabase.from('chapters').update(chapterData).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
}
