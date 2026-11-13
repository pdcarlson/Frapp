import { fetchAllPages } from '../supabase.utils';
import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { EventAttendance } from '#domain/entities/event-attendance.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/** Event ids per `.in()` filter: 100 UUIDs keep the URL near 4 KB. */
const IN_CHUNK = 100;

@Injectable()
export class SupabaseAttendanceRepository implements IAttendanceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByEvent(eventId: string): Promise<EventAttendance[]> {
    const { data, error } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('event_id', eventId);
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null> {
    const { data, error } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByUserForEvents(
    userId: string,
    eventIds: readonly string[],
  ): Promise<EventAttendance[]> {
    const ids = [...new Set(eventIds)];
    const rows: EventAttendance[] = [];
    // In chunks, so a semester of events never builds a request URL past
    // what a proxy in front of PostgREST accepts.
    for (let start = 0; start < ids.length; start += IN_CHUNK) {
      const { data, error } = await this.supabase
        .from('event_attendance')
        .select('*')
        .eq('user_id', userId)
        .in('event_id', ids.slice(start, start + IN_CHUNK));
      if (error) throw new SupabaseQueryError(error);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async findByEvents(eventIds: readonly string[]): Promise<EventAttendance[]> {
    const ids = [...new Set(eventIds)];
    const rows: EventAttendance[] = [];
    for (let start = 0; start < ids.length; start += IN_CHUNK) {
      const chunk = ids.slice(start, start + IN_CHUNK);
      // Paged within the chunk: a row per invited member per event passes
      // the server's row cap in a big chapter, silently (#4792).
      rows.push(
        ...(await fetchAllPages(
          (from, to) =>
            this.supabase
              .from('event_attendance')
              .select('*')
              .in('event_id', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          { pageSize: 1000 },
        )),
      );
    }
    return rows;
  }

  async createMany(
    rows: TablesInsert<'event_attendance'>[],
  ): Promise<EventAttendance[]> {
    if (rows.length === 0) {
      return [];
    }
    const { data, error } = await this.supabase
      .from('event_attendance')
      .insert(rows)
      .select();
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async update(
    id: string,
    data: TablesUpdate<'event_attendance'>,
  ): Promise<EventAttendance> {
    const { data: updated, error } = await this.supabase
      .from('event_attendance')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async checkInAtomic(
    eventId: string,
    userId: string,
    chapterId: string,
    checkInTime: string,
    pointValue: number,
    eventName: string,
  ): Promise<EventAttendance | null> {
    const { data, error } = await this.supabase.rpc('check_in_event', {
      p_event_id: eventId,
      p_user_id: userId,
      p_chapter_id: chapterId,
      p_check_in_time: checkInTime,
      p_point_value: pointValue,
      p_event_name: eventName,
    });
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }
}
