import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
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

  async findBySubscriptionId(subscriptionId: string): Promise<Chapter | null> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(chapterData: TablesInsert<'chapters'>): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .insert(chapterData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    chapterData: TablesUpdate<'chapters'>,
  ): Promise<Chapter> {
    const { data, error } = await this.supabase
      .from('chapters')
      .update(chapterData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
