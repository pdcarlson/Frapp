import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IAttendanceRepository } from '../../../domain/repositories/attendance.repository.interface';
import { EventAttendance } from '../../../domain/entities/event-attendance.entity';

@Injectable()
export class SupabaseAttendanceRepository implements IAttendanceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<EventAttendance | null> {
    const { data } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('id', id)
      .single();

    return data as EventAttendance | null;
  }

  async findByEvent(eventId: string): Promise<EventAttendance[]> {
    const { data } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('event_id', eventId);

    return (data as EventAttendance[]) || [];
  }

  async findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<EventAttendance | null> {
    const { data } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .single();

    return data as EventAttendance | null;
  }

  async create(data: Partial<EventAttendance>): Promise<EventAttendance> {
    const { data: created, error } = await this.supabase
      .from('event_attendance')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created as EventAttendance;
  }

  async update(
    id: string,
    data: Partial<EventAttendance>,
  ): Promise<EventAttendance> {
    const { data: updated, error } = await this.supabase
      .from('event_attendance')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated as EventAttendance;
  }
}
