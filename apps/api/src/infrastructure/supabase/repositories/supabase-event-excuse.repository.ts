import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IEventExcuseRepository } from '#domain/repositories/event-excuse.repository.interface';
import type {
  EventExcuse,
  EventExcuseStatus,
} from '#domain/entities/event-excuse.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class SupabaseEventExcuseRepository implements IEventExcuseRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByEvent(
    chapterId: string,
    eventId: string,
  ): Promise<EventExcuse[]> {
    const { data, error } = await this.supabase
      .from('event_excuses')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findByEventAndUser(
    chapterId: string,
    eventId: string,
    userId: string,
  ): Promise<EventExcuse | null> {
    const { data, error } = await this.supabase
      .from('event_excuses')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findUserIdsByEventAndStatus(
    chapterId: string,
    eventId: string,
    statuses: readonly EventExcuseStatus[],
  ): Promise<string[]> {
    if (statuses.length === 0) return [];
    const { data, error } = await this.supabase
      .from('event_excuses')
      .select('user_id')
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .in('status', [...statuses]);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => row.user_id);
  }

  async create(
    row: TablesInsert<'event_excuses'>,
  ): Promise<EventExcuse | null> {
    const { data, error } = await this.supabase
      .from('event_excuses')
      .insert(row)
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data;
  }

  async decideAtomic(
    excuseId: string,
    chapterId: string,
    decision: 'APPROVED' | 'DECLINED',
    decidedBy: string,
    markAbsent: boolean,
  ): Promise<EventExcuse | null> {
    const { data, error } = await this.supabase.rpc('decide_event_excuse', {
      p_excuse_id: excuseId,
      p_chapter_id: chapterId,
      p_decision: decision,
      p_decided_by: decidedBy,
      p_mark_absent: markAbsent,
    });
    if (error) throw new SupabaseQueryError(error);
    return data?.[0] ?? null;
  }

  async withdrawAtomic(
    chapterId: string,
    eventId: string,
    userId: string,
  ): Promise<EventExcuse | null> {
    const { data, error } = await this.supabase.rpc('withdraw_event_excuse', {
      p_event_id: eventId,
      p_user_id: userId,
      p_chapter_id: chapterId,
    });
    if (error) throw new SupabaseQueryError(error);
    return data?.[0] ?? null;
  }
}
