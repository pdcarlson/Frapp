import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IChapterRepository } from '../../../domain/repositories/chapter.repository.interface';
import { Chapter } from '../../../domain/entities/chapter.entity';

@Injectable()
export class SupabaseChapterRepository implements IChapterRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByStripeCustomerId(customerId: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findBySubscriptionId(subscriptionId: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(chapterData: Partial<Chapter>): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .insert(chapterData as never)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, chapterData: Partial<Chapter>): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .update(chapterData as never)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
