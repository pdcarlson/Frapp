import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IMeetingRecordingRepository,
  MeetingRecordingStep,
  NewMeetingRecording,
} from '#domain/repositories/meeting-recording.repository.interface';
import type {
  MeetingRecording,
  MeetingRecordingRowStatus,
} from '#domain/entities/meeting.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseMeetingRecordingRepository implements IMeetingRecordingRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async find(
    chapterId: string,
    meetingId: string,
  ): Promise<MeetingRecording | null> {
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async start(data: NewMeetingRecording): Promise<MeetingRecording> {
    // Every column but `attendees_notified_at` is written, so nothing else of
    // the earlier upload survives, and the meeting's attendees are still
    // told only once.
    const row: TablesInsert<'meeting_recordings'> = {
      ...data,
      status: 'uploading',
      failure_code: null,
      run_id: null,
      provider_job_id: null,
      transcript: null,
      speaker_count: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    };
    const { data: saved, error } = await this.supabase
      .from('meeting_recordings')
      .upsert(row, { onConflict: 'meeting_id' })
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return saved;
  }

  async step(
    chapterId: string,
    meetingId: string,
    uploadId: string,
    from: readonly MeetingRecordingRowStatus[],
    step: MeetingRecordingStep,
  ): Promise<MeetingRecording | null> {
    const patch: TablesUpdate<'meeting_recordings'> = { ...step };
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .update(patch)
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .eq('upload_id', uploadId)
      .in('status', [...from])
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async claimAttendeeNotice(
    chapterId: string,
    meetingId: string,
    at: string,
  ): Promise<boolean> {
    const patch: TablesUpdate<'meeting_recordings'> = {
      attendees_notified_at: at,
    };
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .update(patch)
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .is('attendees_notified_at', null)
      .select('meeting_id');
    if (error) throw new SupabaseQueryError(error);
    return (data?.length ?? 0) > 0;
  }

  async releaseAttendeeNotice(
    chapterId: string,
    meetingId: string,
  ): Promise<void> {
    const patch: TablesUpdate<'meeting_recordings'> = {
      attendees_notified_at: null,
    };
    const { error } = await this.supabase
      .from('meeting_recordings')
      .update(patch)
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async delete(chapterId: string, meetingId: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_recordings')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async listWithAudio(limit: number): Promise<MeetingRecording[]> {
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .select('*')
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async pathsStillNamed(paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) return [];
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .select('storage_path')
      .in('storage_path', [...paths]);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).flatMap((row) =>
      row.storage_path ? [row.storage_path] : [],
    );
  }

  async deleteCreatedBefore(cutoff: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .delete()
      .lt('created_at', cutoff)
      .select('meeting_id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
