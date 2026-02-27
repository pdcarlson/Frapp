import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { IStudySessionRepository } from '../../../domain/repositories/study.repository.interface';
import type { StudySession } from '../../../domain/entities/study.entity';

@Injectable()
export class SupabaseStudySessionRepository implements IStudySessionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<StudySession | null> {
    const { data, error } = await this.supabase
      .from('study_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as StudySession | null;
  }

  async findActiveByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession | null> {
    const { data, error } = await this.supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (error) throw error;
    return data as StudySession | null;
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession[]> {
    const { data, error } = await this.supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('start_time', { ascending: false });
    if (error) throw error;
    return (data as StudySession[]) || [];
  }

  async create(data: Partial<StudySession>): Promise<StudySession> {
    const { data: created, error } = await this.supabase
      .from('study_sessions')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created as StudySession;
  }

  async update(id: string, data: Partial<StudySession>): Promise<StudySession> {
    const { data: updated, error } = await this.supabase
      .from('study_sessions')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated as StudySession;
  }
}
