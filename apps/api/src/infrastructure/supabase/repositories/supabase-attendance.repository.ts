import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { EventAttendance } from '#domain/entities/event-attendance.entity';

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
    if (error) throw error;
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
    if (error) throw error;
    return data;
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
    if (error) throw error;
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

    if (error) throw error;
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
    if (error) throw error;
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }
}
