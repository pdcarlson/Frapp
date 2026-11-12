import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IStudySessionRepository,
  StudySessionFinish,
} from '#domain/repositories/study.repository.interface';
import type { StudySession } from '#domain/entities/study.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseStudySessionRepository implements IStudySessionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

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
    if (error) throw new SupabaseQueryError(error);
    return data;
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
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async create(data: TablesInsert<'study_sessions'>): Promise<StudySession> {
    const { data: created, error } = await this.supabase
      .from('study_sessions')
      .insert(data)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async updateIfUnchanged(
    session: Pick<StudySession, 'id' | 'last_heartbeat_at' | 'paused_at'>,
    chapterId: string,
    data: TablesUpdate<'study_sessions'>,
  ): Promise<StudySession | null> {
    let query = this.supabase
      .from('study_sessions')
      .update(data)
      .eq('id', session.id)
      .eq('chapter_id', chapterId)
      .eq('status', 'ACTIVE')
      .eq('last_heartbeat_at', session.last_heartbeat_at);
    query =
      session.paused_at === null
        ? query.is('paused_at', null)
        : query.eq('paused_at', session.paused_at);

    const { data: updated, error } = await query.select().maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async finish(
    session: Pick<StudySession, 'id' | 'last_heartbeat_at' | 'paused_at'>,
    chapterId: string,
    finish: StudySessionFinish,
  ): Promise<StudySession | null> {
    const { data, error } = await this.supabase.rpc('finish_study_session', {
      p_session_id: session.id,
      p_chapter_id: chapterId,
      p_expected_last_heartbeat_at: session.last_heartbeat_at,
      p_expected_paused_at: session.paused_at,
      p_status: finish.status,
      p_end_time: finish.end_time,
      p_last_heartbeat_at: finish.last_heartbeat_at,
      p_total_foreground_minutes: finish.total_foreground_minutes,
      p_points: finish.points,
      p_description: finish.description,
    });
    if (error) throw new SupabaseQueryError(error);
    // An empty set means the compare-and-set matched nothing.
    return (data ?? [])[0] ?? null;
  }
}
