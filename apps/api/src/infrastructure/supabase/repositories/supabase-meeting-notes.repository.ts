import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IMeetingNotesRepository } from '#domain/repositories/meeting-notes.repository.interface';
import type { MeetingNote } from '#domain/entities/meeting.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseMeetingNotesRepository implements IMeetingNotesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByMeeting(
    chapterId: string,
    meetingId: string,
  ): Promise<MeetingNote[]> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async find(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MeetingNote | null> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByUser(chapterId: string, userId: string): Promise<MeetingNote[]> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async upsert(row: {
    meeting_id: string;
    chapter_id: string;
    user_id: string;
    notes: string;
    added_by: string | null;
  }): Promise<MeetingNote> {
    const now = new Date().toISOString();
    // An update first, so `added_by` and `created_at` (the 30-day clock)
    // stay as they were for a member already taking notes.
    const { data: updated, error: updateError } = await this.supabase
      .from('meeting_notes')
      .update({ notes: row.notes, updated_at: now })
      .eq('chapter_id', row.chapter_id)
      .eq('meeting_id', row.meeting_id)
      .eq('user_id', row.user_id)
      .select()
      .maybeSingle();
    if (updateError) throw new SupabaseQueryError(updateError);
    if (updated) return updated;
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .upsert(
        { ...row, created_at: now, updated_at: now },
        { onConflict: 'meeting_id,user_id' },
      )
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async add(row: {
    meeting_id: string;
    chapter_id: string;
    user_id: string;
    added_by: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_notes')
      .upsert(
        { ...row, notes: '' },
        { onConflict: 'meeting_id,user_id', ignoreDuplicates: true },
      );
    if (error) throw new SupabaseQueryError(error);
  }

  async delete(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_notes')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('meeting_id', meetingId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
  }

  async deleteCreatedBefore(cutoff: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .delete()
      .lt('created_at', cutoff)
      .select('meeting_id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
