import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChapterGoalRepository } from '#domain/repositories/chapter-goal.repository.interface';
import type {
  ChapterGoalRow,
  GoalMetric,
  GoalSet,
} from '#domain/entities/chapter-goal.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseChapterGoalRepository implements IChapterGoalRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterGoalRow[]> {
    const { data, error } = await this.supabase
      .from('chapter_goals')
      .select('*')
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async upsert(
    chapterId: string,
    metric: GoalMetric,
    goals: GoalSet,
    updatedBy: string,
  ): Promise<ChapterGoalRow> {
    const { data, error } = await this.supabase
      .from('chapter_goals')
      .upsert(
        {
          metric,
          goals,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
          chapter_id: chapterId,
        },
        { onConflict: 'chapter_id,metric' },
      )
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }
}
