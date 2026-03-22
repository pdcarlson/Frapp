import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IAttendanceRepository } from '../../../domain/repositories/attendance.repository.interface';
import { EventAttendance } from '../../../domain/entities/event-attendance.entity';

@Injectable()
export class SupabaseAttendanceRepository implements IAttendanceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<EventAttendance | null> {
    const { data, error } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as EventAttendance | null;
  }

  async findByEvent(eventId: string): Promise<EventAttendance[]> {
    const { data, error } = await this.supabase
      .from('event_attendance')
      .select('*')
      .eq('event_id', eventId);
    if (error) throw error;
    return (data as EventAttendance[]) || [];
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
    return data as EventAttendance | null;
  }

  async create(data: Partial<EventAttendance>): Promise<EventAttendance> {
    const { data: created, error } = await this.supabase
      .from('event_attendance')
      .insert(data as never)
      .select()
      .single();

    if (error) throw error;
    return created as EventAttendance;
  }

  async createMany(data: Partial<EventAttendance>[]): Promise<void> {
    if (data.length === 0) return;
    const { error } = await this.supabase
      .from('event_attendance')
      .insert(data as never[]);
    if (error) throw error;
  }

  async update(
    id: string,
    data: Partial<EventAttendance>,
  ): Promise<EventAttendance> {
    const { data: updated, error } = await this.supabase
      .from('event_attendance')
      .update(data as never)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated as EventAttendance;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('event_attendance')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
